//! Minimal HTTP/1.1 building blocks (std only) + `noru start` / `noru preview`: a static file
//! server for the build output, with SPA fallback, gzip and long-term caching of hashed assets.

use std::io::{BufRead, BufReader, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::asset::mime_type;

pub(crate) struct Request {
    pub method: String,
    /// Decoded path, without query string.
    pub path: String,
    pub accepts_gzip: bool,
    /// `If-None-Match` header (ETag the browser already has).
    pub if_none_match: Option<String>,
}

pub(crate) fn read_request(stream: &TcpStream) -> std::io::Result<Request> {
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut request_line = String::new();
    reader.read_line(&mut request_line)?;
    let mut accepts_gzip = false;
    let mut if_none_match = None;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line)? == 0 || line == "\r\n" || line == "\n" {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            let name = name.trim();
            if name.eq_ignore_ascii_case("accept-encoding") && value.contains("gzip") {
                accepts_gzip = true;
            } else if name.eq_ignore_ascii_case("if-none-match") {
                if_none_match = Some(value.trim().to_string());
            }
        }
    }
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let target = parts.next().unwrap_or("/");
    let path = percent_decode(target.split(['?', '#']).next().unwrap_or("/"));
    Ok(Request { method, path, accepts_gzip, if_none_match })
}

pub(crate) struct Response<'a> {
    pub status: &'a str,
    pub content_type: &'a str,
    pub body: &'a [u8],
    pub cache_control: &'a str,
    /// Gzip the body when the browser accepts it (pointless on localhost in dev).
    pub compress: bool,
}

impl<'a> Response<'a> {
    pub fn ok(content_type: &'a str, body: &'a [u8]) -> Self {
        Self { status: "200 OK", content_type, body, cache_control: "no-cache", compress: true }
    }

    pub fn not_found() -> Self {
        Self {
            status: "404 Not Found",
            content_type: "text/plain",
            body: b"not found",
            cache_control: "no-cache",
            compress: false,
        }
    }
}

fn is_compressible(content_type: &str) -> bool {
    content_type.starts_with("text/")
        || content_type.contains("javascript")
        || content_type.contains("json")
        || content_type.contains("svg")
        || content_type.contains("manifest")
}

pub(crate) fn send(stream: &mut TcpStream, req: &Request, res: Response) -> std::io::Result<()> {
    // ETag: lets the browser revalidate with a cheap 304 instead of downloading (and re-compiling)
    // unchanged files on every reload.
    let etag = res.status.starts_with("200").then(|| format!("\"{:016x}\"", xxhash_rust::xxh3::xxh3_64(res.body)));
    if let (Some(etag), Some(known)) = (&etag, &req.if_none_match) {
        if known.split(',').any(|candidate| candidate.trim().trim_start_matches("W/") == etag) {
            let header = format!(
                "HTTP/1.1 304 Not Modified\r\nETag: {etag}\r\nCache-Control: {}\r\nConnection: close\r\n\r\n",
                res.cache_control
            );
            stream.write_all(header.as_bytes())?;
            return stream.flush();
        }
    }
    let etag_header = etag.map(|etag| format!("ETag: {etag}\r\n")).unwrap_or_default();

    let compressed;
    let (body, encoding) =
        if res.compress && req.accepts_gzip && res.body.len() > 1024 && is_compressible(res.content_type) {
            let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
            encoder.write_all(res.body)?;
            compressed = encoder.finish()?;
            (compressed.as_slice(), "Content-Encoding: gzip\r\nVary: Accept-Encoding\r\n")
        } else {
            (res.body, "")
        };
    let header = format!(
        "HTTP/1.1 {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nCache-Control: {}\r\n{etag_header}{encoding}Connection: close\r\n\r\n",
        res.status,
        res.content_type,
        body.len(),
        res.cache_control,
    );
    stream.write_all(header.as_bytes())?;
    if req.method != "HEAD" {
        stream.write_all(body)?;
    }
    stream.flush()
}

/// Maps an URL path to a file inside `dir` (directories map to their `index.html`).
/// Returns `None` for missing files and path traversal attempts.
pub(crate) fn safe_join(dir: &Path, url_path: &str) -> Option<PathBuf> {
    let mut candidate = dir.to_path_buf();
    for segment in url_path.split('/') {
        match segment {
            "" | "." => {}
            ".." => return None,
            s if s.contains('\\') || s.contains(':') => return None,
            s => candidate.push(s),
        }
    }
    if candidate.is_dir() {
        candidate.push("index.html");
    }
    candidate.is_file().then_some(candidate)
}

pub(crate) fn extension_of(path: &str) -> String {
    let last = path.rsplit('/').next().unwrap_or("");
    last.rsplit_once('.').map(|(_, ext)| ext.to_ascii_lowercase()).unwrap_or_default()
}

pub(crate) fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Static server for the production build (`noru start` / `noru preview`).
pub struct PreviewServer {
    listener: TcpListener,
    dir: Arc<PathBuf>,
}

impl PreviewServer {
    /// Binds to `host:port` (`port = 0` picks a free port).
    pub fn bind(dir: impl Into<PathBuf>, host: &str, port: u16) -> std::io::Result<Self> {
        let listener = TcpListener::bind((host, port))?;
        Ok(Self { listener, dir: Arc::new(dir.into()) })
    }

    pub fn local_addr(&self) -> std::io::Result<SocketAddr> {
        self.listener.local_addr()
    }

    /// Serves forever, one thread per connection.
    pub fn run(self) {
        for stream in self.listener.incoming().flatten() {
            let dir = Arc::clone(&self.dir);
            std::thread::spawn(move || {
                let _ = handle_static(stream, &dir);
            });
        }
    }
}

fn handle_static(mut stream: TcpStream, dir: &Path) -> std::io::Result<()> {
    let req = read_request(&stream)?;
    if req.method != "GET" && req.method != "HEAD" {
        let res = Response { status: "405 Method Not Allowed", ..Response::not_found() };
        return send(&mut stream, &req, res);
    }
    let file = safe_join(dir, &req.path).or_else(|| {
        // SPA fallback for client-side routes (paths without a file extension).
        if extension_of(&req.path).is_empty() {
            safe_join(dir, "/index.html")
        } else {
            None
        }
    });
    let Some(file) = file else {
        return send(&mut stream, &req, Response::not_found());
    };
    let body = std::fs::read(&file)?;
    let ext = file.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    // Files in assets/ have a content hash in their name: they can be cached forever.
    let cache_control = if req.path.contains("/assets/") { "public, max-age=31536000, immutable" } else { "no-cache" };
    send(&mut stream, &req, Response { cache_control, ..Response::ok(mime_type(&ext), &body) })
}
