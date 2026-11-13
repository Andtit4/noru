//! Server parts of Next.js apps: the middleware (`middleware.ts` / `proxy.ts`) and the route handlers
//! (`route.ts`). noru bundles them for Node.js (npm packages stay external, loaded by Node.js) and
//! runs them in a long-lived Node.js process (`server-runtime.js` + `server-worker.js`); the Rust
//! dev / preview servers send it the requests.

use std::collections::HashMap;
use std::ffi::OsString;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use base64::Engine;

use crate::module::ModuleKey;
use crate::serve::send_raw;

/// The runtime library (also written to `dist/server/runtime.js` for the npm package's server).
pub const RUNTIME: &str = include_str!("server-runtime.js");
const WORKER: &str = include_str!("server-worker.js");
const MARKER: &str = "\u{0}noru-server:";
const EXTERNAL_QUERY: &str = "?noru-external=";

/// How the server bundle is built: its entry is generated, npm packages are required at runtime.
pub struct ServerTarget {
    pub root: PathBuf,
    pub entry: PathBuf,
    pub entry_source: String,
    external: PathBuf,
}

impl ServerTarget {
    pub fn new(root: &Path, virtual_dir: &Path, entry_source: String) -> Self {
        Self {
            root: root.to_path_buf(),
            entry: virtual_dir.join("server-entry.js"),
            entry_source,
            external: virtual_dir.join("external.js"),
        }
    }

    /// A module loaded by Node.js at runtime (`require("next-auth")`).
    pub fn external(&self, specifier: &str) -> ModuleKey {
        ModuleKey::new(self.external.clone(), Some(format!("{EXTERNAL_QUERY}{}", crate::next::escape_query(specifier))))
    }

    pub fn external_factory(&self, key: &ModuleKey) -> Option<String> {
        if key.path != self.external {
            return None;
        }
        let specifier = crate::next::unescape_query(key.query.as_deref()?.strip_prefix(EXTERNAL_QUERY)?);
        let specifier = serde_json::to_string(&specifier).unwrap_or_default();
        Some(format!("function(module) {{ module.exports = __noru_node_require({specifier}); }}"))
    }

    /// Imports of the generated entry resolve from the project root.
    pub fn importer(&self, importer: &Path) -> PathBuf {
        if importer == self.entry {
            self.root.join("__noru_server__.js")
        } else {
            importer.to_path_buf()
        }
    }
}

type Pending = Arc<Mutex<HashMap<u64, mpsc::Sender<Result<serde_json::Value, String>>>>>;

/// The Node.js process running the server bundle.
pub struct ServerRuntime {
    stdin: Mutex<ChildStdin>,
    child: Mutex<Child>,
    pending: Pending,
    next_id: AtomicU64,
    loaded: Mutex<Option<u64>>,
}

pub struct ServerRequest<'a> {
    pub method: &'a str,
    /// Absolute URL (`http://host/path?query`).
    pub url: String,
    pub headers: &'a [(String, String)],
    pub body: &'a [u8],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    /// Let noru serve the page (possibly rewritten to another path).
    Next,
    Redirect,
    /// A response made by the middleware or a route handler.
    Response,
}

#[derive(Debug)]
pub struct ServerAnswer {
    pub action: Action,
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub location: Option<String>,
    pub rewrite: Option<String>,
    pub body: Vec<u8>,
}

impl ServerRuntime {
    pub fn start(root: &Path, mode: &str) -> Result<Self, String> {
        let node = std::env::var_os("NORU_NODE").unwrap_or_else(|| OsString::from("node"));
        let script = format!("{RUNTIME}\n{WORKER}");
        let mut child = Command::new(&node)
            .arg("-e")
            .arg(&script)
            .arg(root)
            .arg(mode)
            .current_dir(root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|e| {
                format!(
                    "the middleware and API routes need Node.js, but `{}` could not be started: {e}",
                    node.to_string_lossy()
                )
            })?;
        let stdin = child.stdin.take().ok_or("Next.js server process has no stdin")?;
        let stdout = child.stdout.take().ok_or("Next.js server process has no stdout")?;
        let pending: Pending = Arc::default();
        let reader_pending = Arc::clone(&pending);
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                let Some(json) = line.strip_prefix(MARKER) else { continue };
                let Ok(message) = serde_json::from_str::<serde_json::Value>(json) else { continue };
                let Some(id) = message.get("id").and_then(|v| v.as_u64()) else { continue };
                let result = match message.get("error").and_then(|e| e.as_str()) {
                    Some(error) => Err(error.to_string()),
                    None => Ok(message.get("result").cloned().unwrap_or_default()),
                };
                if let Some(sender) = reader_pending.lock().ok().and_then(|mut p| p.remove(&id)) {
                    let _ = sender.send(result);
                }
            }
            // The process stopped: the waiting requests fail instead of hanging.
            if let Ok(mut waiting) = reader_pending.lock() {
                for (_, sender) in waiting.drain() {
                    let _ = sender.send(Err("the Next.js server process (Node.js) stopped".to_string()));
                }
            }
        });
        Ok(Self {
            stdin: Mutex::new(stdin),
            child: Mutex::new(child),
            pending,
            next_id: AtomicU64::new(1),
            loaded: Mutex::new(None),
        })
    }

    fn call(&self, mut message: serde_json::Value) -> Result<serde_json::Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        message["id"] = id.into();
        let (tx, rx) = mpsc::channel();
        self.pending.lock().map_err(|_| "Next.js server: lock poisoned")?.insert(id, tx);
        {
            let mut stdin = self.stdin.lock().map_err(|_| "Next.js server: lock poisoned")?;
            let line = format!("{message}\n");
            stdin
                .write_all(line.as_bytes())
                .and_then(|()| stdin.flush())
                .map_err(|e| format!("Next.js server process: {e}"))?;
        }
        match rx.recv_timeout(Duration::from_secs(120)) {
            Ok(result) => result,
            Err(_) => {
                if let Ok(mut pending) = self.pending.lock() {
                    pending.remove(&id);
                }
                Err("the Next.js server process did not answer within 120 s".to_string())
            }
        }
    }

    /// Loads the server bundle (does nothing if it did not change).
    pub fn load(&self, code: &str) -> Result<(), String> {
        let hash = xxhash_rust::xxh3::xxh3_64(code.as_bytes());
        if self.loaded.lock().map(|l| *l == Some(hash)).unwrap_or(false) {
            return Ok(());
        }
        self.call(serde_json::json!({ "type": "load", "code": code }))?;
        if let Ok(mut loaded) = self.loaded.lock() {
            *loaded = Some(hash);
        }
        Ok(())
    }

    /// Middleware + route handlers for a request.
    pub fn handle(&self, request: &ServerRequest) -> Result<ServerAnswer, String> {
        self.request("request", request)
    }

    /// Only the middleware (client-side navigations).
    pub fn middleware(&self, request: &ServerRequest) -> Result<ServerAnswer, String> {
        self.request("middleware", request)
    }

    fn request(&self, kind: &str, request: &ServerRequest) -> Result<ServerAnswer, String> {
        let body = (!request.body.is_empty()).then(|| base64::engine::general_purpose::STANDARD.encode(request.body));
        let message = serde_json::json!({
            "type": kind,
            "request": { "method": request.method, "url": request.url, "headers": request.headers, "body": body },
        });
        Ok(parse_answer(&self.call(message)?))
    }
}

impl Drop for ServerRuntime {
    fn drop(&mut self) {
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// What the dev / preview server does after the Next.js server code saw a request.
pub(crate) enum Dispatch {
    /// The middleware or a route handler answered.
    Done,
    /// Serve the page (index.html), maybe for another path, with these extra headers (cookies...).
    Page { rewrite: Option<String>, headers: Vec<(String, String)> },
}

/// Runs the middleware and route handlers for a request; answers it unless it is a page.
pub(crate) fn dispatch(
    runtime: &ServerRuntime,
    stream: &mut TcpStream,
    req: &crate::serve::Request,
) -> std::io::Result<Dispatch> {
    let request = ServerRequest { method: &req.method, url: req.url(), headers: &req.headers, body: &req.body };
    match runtime.handle(&request) {
        Ok(answer) => match answer.action {
            Action::Redirect => {
                let mut headers = answer.headers;
                headers.push(("Location".to_string(), answer.location.unwrap_or_else(|| "/".to_string())));
                send_raw(stream, req, answer.status, &headers, b"")?;
                Ok(Dispatch::Done)
            }
            Action::Response => {
                send_raw(stream, req, answer.status, &answer.headers, &answer.body)?;
                Ok(Dispatch::Done)
            }
            Action::Next => Ok(Dispatch::Page { rewrite: answer.rewrite, headers: answer.headers }),
        },
        Err(error) => {
            eprintln!("[noru] error in the middleware / route handler for {}:\n{error}", req.target);
            let headers = [("Content-Type".to_string(), "text/plain; charset=utf-8".to_string())];
            send_raw(stream, req, 500, &headers, format!("Internal Server Error\n\n{error}").as_bytes())?;
            Ok(Dispatch::Done)
        }
    }
}

/// `/@noru/middleware?url=/some/path`: what the middleware says about a client-side navigation.
pub(crate) fn middleware_endpoint(
    runtime: &ServerRuntime,
    stream: &mut TcpStream,
    req: &crate::serve::Request,
) -> std::io::Result<()> {
    let query = req.target.split_once('?').map_or("", |(_, q)| q);
    let target = query
        .split('&')
        .find_map(|pair| pair.strip_prefix("url="))
        .map(|v| crate::serve::percent_decode(&v.replace('+', " ")))
        .filter(|v| v.starts_with('/'))
        .unwrap_or_else(|| "/".to_string());
    let url = format!("http://{}{target}", req.header("host").unwrap_or("localhost"));
    let request = ServerRequest { method: "GET", url, headers: &req.headers, body: b"" };
    let (json, mut headers) = match runtime.middleware(&request) {
        Ok(answer) => {
            let action = match answer.action {
                Action::Next => "next",
                Action::Redirect => "redirect",
                Action::Response => "response",
            };
            let json = serde_json::json!({ "action": action, "location": answer.location, "rewrite": answer.rewrite });
            // Cookies set by the middleware apply to the page.
            let cookies = answer.headers.into_iter().filter(|(n, _)| n.eq_ignore_ascii_case("set-cookie")).collect();
            (json, cookies)
        }
        Err(error) => {
            eprintln!("[noru] error in the middleware for {target}:\n{error}");
            (serde_json::json!({ "action": "response" }), Vec::new())
        }
    };
    headers.push(("Content-Type".to_string(), "application/json".to_string()));
    headers.push(("Cache-Control".to_string(), "no-store".to_string()));
    send_raw(stream, req, 200, &headers, json.to_string().as_bytes())
}

/// The page, with what the middleware decided (rewritten path, cookies).
pub(crate) fn send_page(
    stream: &mut TcpStream,
    req: &crate::serve::Request,
    html: &str,
    rewrite: Option<&str>,
    extra_headers: &[(String, String)],
) -> std::io::Result<()> {
    let html = match rewrite {
        Some(path) => {
            let value = serde_json::to_string(path).unwrap_or_default().replace("</", "<\\/");
            let script = format!("    <script>window.__NORU_REWRITE__ = {value}</script>\n  </head>");
            html.replacen("  </head>", &script, 1)
        }
        None => html.to_string(),
    };
    let mut headers = vec![
        ("Content-Type".to_string(), "text/html; charset=utf-8".to_string()),
        ("Cache-Control".to_string(), "no-cache".to_string()),
    ];
    headers.extend(extra_headers.iter().cloned());
    send_raw(stream, req, 200, &headers, html.as_bytes())
}

fn parse_answer(value: &serde_json::Value) -> ServerAnswer {
    let text = |name: &str| value.get(name).and_then(|v| v.as_str()).filter(|s| !s.is_empty()).map(str::to_string);
    let headers = value
        .get("headers")
        .and_then(|h| h.as_array())
        .map(|list| {
            list.iter()
                .filter_map(|pair| Some((pair.get(0)?.as_str()?.to_string(), pair.get(1)?.as_str()?.to_string())))
                .collect()
        })
        .unwrap_or_default();
    ServerAnswer {
        action: match value.get("action").and_then(|a| a.as_str()) {
            Some("redirect") => Action::Redirect,
            Some("response") => Action::Response,
            _ => Action::Next,
        },
        status: value.get("status").and_then(|s| s.as_u64()).unwrap_or(200) as u16,
        headers,
        location: text("location"),
        rewrite: text("rewrite"),
        body: text("body").and_then(|b| base64::engine::general_purpose::STANDARD.decode(b).ok()).unwrap_or_default(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_answers() {
        let answer = parse_answer(&serde_json::json!({
            "action": "redirect", "status": 307, "location": "http://localhost/fr/login",
            "headers": [["set-cookie", "a=1; Path=/"], ["x-test", "yes"]], "body": ""
        }));
        assert_eq!(answer.action, Action::Redirect);
        assert_eq!(answer.status, 307);
        assert_eq!(answer.location.as_deref(), Some("http://localhost/fr/login"));
        assert_eq!(answer.headers.len(), 2);
        let answer =
            parse_answer(&serde_json::json!({ "action": "response", "status": 201, "body": "aGk=", "headers": [] }));
        assert_eq!((answer.action, answer.body.as_slice()), (Action::Response, b"hi".as_slice()));
        assert_eq!(
            parse_answer(&serde_json::json!({ "action": "next", "rewrite": "/dashboard" })).rewrite.as_deref(),
            Some("/dashboard")
        );
    }

    #[test]
    fn external_modules() {
        let target = ServerTarget::new(Path::new("/app"), Path::new("/app/node_modules/.noru-next"), String::new());
        let key = target.external("@formatjs/intl-localematcher?x");
        assert_eq!(
            target.external_factory(&key).unwrap(),
            "function(module) { module.exports = __noru_node_require(\"@formatjs/intl-localematcher?x\"); }"
        );
        assert!(target.external_factory(&ModuleKey::new(PathBuf::from("/app/x.js"), None)).is_none());
    }
}
