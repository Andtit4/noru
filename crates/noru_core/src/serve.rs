//! Minimal HTTP/1.1 building blocks (std only) + `noru start` / `noru preview`: a static file
//! server for the build output, with SPA fallback, gzip and long-term caching of hashed assets.

use std::io::{BufRead, BufReader, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::asset::mime_type;
use crate::next::server::{dispatch, middleware_endpoint, send_page, Dispatch, ServerRuntime};

pub(crate) struct Request {
    pub method: String,
    /// Decoded path, without query string.
    pub path: String,
    /// The raw request target (path and query string, not decoded).
    pub target: String,
    pub accepts_gzip: bool,
    /// `If-None-Match` header (ETag the browser already has).
    pub if_none_match: Option<String>,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Request {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(n, _)| n.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }

    /// Absolute URL of the request (for the Next.js server code).
    pub fn url(&self) -> String {
        format!("http://{}{}", self.header("host").unwrap_or("localhost"), self.target)
    }
}

/// Request bodies larger than this are refused (route handlers receive forms and JSON, not files).
const MAX_BODY: usize = 50 * 1024 * 1024;

pub(crate) fn read_request(stream: &TcpStream) -> std::io::Result<Request> {
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut request_line = String::new();
    reader.read_line(&mut request_line)?;
    let mut accepts_gzip = false;
    let mut if_none_match = None;
    let mut headers = Vec::new();
    let mut content_length = 0usize;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line)? == 0 || line == "\r\n" || line == "\n" {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            let (name, value) = (name.trim(), value.trim());
            if name.eq_ignore_ascii_case("accept-encoding") && value.contains("gzip") {
                accepts_gzip = true;
            } else if name.eq_ignore_ascii_case("if-none-match") {
                if_none_match = Some(value.to_string());
            } else if name.eq_ignore_ascii_case("content-length") {
                content_length = value.parse().unwrap_or(0);
            }
            headers.push((name.to_string(), value.to_string()));
        }
    }
    let mut body = Vec::new();
    if content_length > 0 && content_length <= MAX_BODY {
        body.resize(content_length, 0);
        std::io::Read::read_exact(&mut reader, &mut body)?;
    }
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let target = parts.next().unwrap_or("/").to_string();
    let path = percent_decode(target.split(['?', '#']).next().unwrap_or("/"));
    Ok(Request { method, path, target, accepts_gzip, if_none_match, headers, body })
}

/// Sends a response made by the Next.js server code (status, headers and body as they are).
pub(crate) fn send_raw(
    stream: &mut TcpStream,
    req: &Request,
    status: u16,
    headers: &[(String, String)],
    body: &[u8],
) -> std::io::Result<()> {
    let mut head = format!("HTTP/1.1 {status} {}\r\n", reason_phrase(status));
    for (name, value) in headers {
        if name.eq_ignore_ascii_case("content-length")
            || name.eq_ignore_ascii_case("transfer-encoding")
            || name.eq_ignore_ascii_case("connection")
            || name.eq_ignore_ascii_case("content-encoding")
        {
            continue;
        }
        head.push_str(&format!("{name}: {}\r\n", value.replace(['\r', '\n'], " ")));
    }
    head.push_str(&format!("Content-Length: {}\r\nConnection: close\r\n\r\n", body.len()));
    stream.write_all(head.as_bytes())?;
    if req.method != "HEAD" {
        stream.write_all(body)?;
    }
    stream.flush()
}

fn reason_phrase(status: u16) -> &'static str {
    match status {
        200 => "OK",
        201 => "Created",
        204 => "No Content",
        301 => "Moved Permanently",
        302 => "Found",
        303 => "See Other",
        304 => "Not Modified",
        307 => "Temporary Redirect",
        308 => "Permanent Redirect",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        409 => "Conflict",
        422 => "Unprocessable Content",
        429 => "Too Many Requests",
        500 => "Internal Server Error",
        502 => "Bad Gateway",
        503 => "Service Unavailable",
        _ => "",
    }
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
    /// Next.js middleware and route handlers of the build (`dist/server/app.js`), run by Node.js.
    server: Option<Arc<ServerRuntime>>,
}

impl PreviewServer {
    /// Binds to `host:port` (`port = 0` picks a free port).
    pub fn bind(dir: impl Into<PathBuf>, host: &str, port: u16) -> std::io::Result<Self> {
        let listener = TcpListener::bind((host, port))?;
        Ok(Self { listener, dir: Arc::new(dir.into()), server: None })
    }

    /// Starts the Node.js process of the Next.js middleware and route handlers, if the build has
    /// any. `root` is the project: its `.env` files and `node_modules` are used.
    pub fn start_server_code(&mut self, root: &Path) -> Result<bool, String> {
        let Ok(code) = std::fs::read_to_string(self.dir.join("server").join("app.js")) else { return Ok(false) };
        let runtime = ServerRuntime::start(root, "production")?;
        runtime.load(&code)?;
        self.server = Some(Arc::new(runtime));
        Ok(true)
    }

    pub fn local_addr(&self) -> std::io::Result<SocketAddr> {
        self.listener.local_addr()
    }

    /// Serves forever, one thread per connection.
    pub fn run(self) {
        for stream in self.listener.incoming().flatten() {
            let dir = Arc::clone(&self.dir);
            let server = self.server.clone();
            std::thread::spawn(move || {
                let _ = handle_static(stream, &dir, server.as_deref());
            });
        }
    }
}

/// The server code of the build (`dist/server/`) is never sent to browsers.
fn is_server_code(path: &str) -> bool {
    path.trim_start_matches('/').starts_with("server/")
}

fn handle_static(mut stream: TcpStream, dir: &Path, server: Option<&ServerRuntime>) -> std::io::Result<()> {
    let req = read_request(&stream)?;
    // Client-side navigations ask the middleware first.
    if let (Some(runtime), "/@noru/middleware") = (server, req.path.as_str()) {
        return middleware_endpoint(runtime, &mut stream, &req);
    }
    let reading = req.method == "GET" || req.method == "HEAD";
    if server.is_none() && !reading {
        let res = Response { status: "405 Method Not Allowed", ..Response::not_found() };
        return send(&mut stream, &req, res);
    }
    let static_file = safe_join(dir, &req.path)
        .filter(|file| !is_server_code(&req.path) && file.file_name().is_some_and(|name| name != "index.html"));
    if let (Some(file), true) = (&static_file, reading) {
        return send_file(&mut stream, &req, file);
    }
    // Next.js middleware and route handlers (API routes) decide first.
    if let Some(runtime) = server {
        return match dispatch(runtime, &mut stream, &req)? {
            Dispatch::Done => Ok(()),
            Dispatch::Page { rewrite, headers } => {
                let target = rewrite.as_deref().map_or(req.path.as_str(), |r| r.split('?').next().unwrap_or(r));
                if target != "/" && !extension_of(target).is_empty() {
                    return send(&mut stream, &req, Response::not_found());
                }
                let html = std::fs::read_to_string(dir.join("index.html"))?;
                send_page(&mut stream, &req, &html, rewrite.as_deref(), &headers)
            }
        };
    }
    // index.html, and SPA fallback for client-side routes (paths without a file extension).
    let index = (extension_of(&req.path).is_empty() || req.path.ends_with("/index.html"))
        .then(|| safe_join(dir, "/index.html"))
        .flatten();
    match index {
        Some(file) => send_file(&mut stream, &req, &file),
        None => send(&mut stream, &req, Response::not_found()),
    }
}

fn send_file(stream: &mut TcpStream, req: &Request, file: &Path) -> std::io::Result<()> {
    let body = std::fs::read(file)?;
    let ext = file.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    // Files in assets/ have a content hash in their name: they can be cached forever.
    let cache_control = if req.path.contains("/assets/") { "public, max-age=31536000, immutable" } else { "no-cache" };
    send(stream, req, Response { cache_control, ..Response::ok(mime_type(&ext), &body) })
}
