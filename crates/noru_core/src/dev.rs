//! `noru dev`: the development server.
//!
//! Unlike frameworks that compile each page the first time you open it, noru bundles the whole
//! app up-front (in parallel, in memory), so every page is ready immediately. Processed modules
//! are cached: when a file changes only that file is processed again, then the browser reloads
//! (stylesheets are swapped without a reload). Build errors are shown in an overlay.

use std::collections::{HashMap, VecDeque};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, LazyLock, Mutex, RwLock};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use regex::Regex;

use crate::asset::mime_type;
use crate::build::{BuildError, Project, StableIds};
use crate::bundle::{generate_hot_update, RenderedModule};
use crate::graph::ModuleCache;
use crate::html::rewrite_html;
use crate::options::BuildOptions;
use crate::serve::{extension_of, read_request, safe_join, send, Response};

const CLIENT: &str = include_str!("client.js");
const IGNORED_DIRS: &[&str] = &["node_modules", "target", "coverage", "build"];

#[derive(Debug, Clone)]
pub struct DevOptions {
    /// Build options (mode defaults to `development`, minification is off).
    pub build: BuildOptions,
    pub host: String,
    pub port: u16,
    /// Print startup and rebuild logs to stdout.
    pub log: bool,
}

impl DevOptions {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        let mut build = BuildOptions::new(root);
        build.mode = "development".to_string();
        build.minify = false;
        // Tree-shaking only matters for production bundles; skipping it keeps rebuilds instant.
        build.treeshake = false;
        build.hmr = true;
        Self { build, host: "127.0.0.1".to_string(), port: 3000, log: true }
    }
}

/// How many hot update scripts are kept for clients that are a bit late to fetch them.
const KEPT_UPDATES: usize = 30;

#[derive(Default)]
struct Output {
    html: String,
    js: String,
    css: String,
    assets: HashMap<String, Vec<u8>>,
    error: Option<String>,
    version: u64,
    /// Factory source of every module currently in the bundle, by id (to find what changed).
    factories: HashMap<usize, String>,
    /// Recent hot update scripts: (version, code).
    updates: VecDeque<(u64, String)>,
}

struct Shared {
    output: RwLock<Output>,
    clients: Mutex<Vec<Sender<String>>>,
    public_dir: PathBuf,
    base: String,
    shutdown: AtomicBool,
}

impl Shared {
    fn broadcast(&self, message: &serde_json::Value) {
        let text = message.to_string();
        if let Ok(mut clients) = self.clients.lock() {
            clients.retain(|client| client.send(text.clone()).is_ok());
        }
    }
}

/// Owns the project, the module cache and the stable module ids; lives on the rebuild thread.
struct Builder {
    options: BuildOptions,
    project: Option<Project>,
    cache: ModuleCache,
    ids: StableIds,
}

struct Built {
    html: String,
    js: String,
    css: String,
    assets: HashMap<String, Vec<u8>>,
    modules: Vec<RenderedModule>,
    module_count: usize,
    processed_count: usize,
    warnings: Vec<String>,
}

impl Builder {
    fn new(options: BuildOptions) -> Self {
        Self { options, project: None, cache: ModuleCache::default(), ids: StableIds::default() }
    }

    fn build(&mut self, reload_project: bool) -> Result<Built, BuildError> {
        if reload_project || self.project.is_none() {
            self.project = None;
            self.project = Some(Project::load(&self.options)?);
        }
        let project = self.project.as_ref().expect("project loaded above");
        let bundle = project.bundle_dev(&mut self.cache, &mut self.ids)?;
        let base = &project.base;
        let tags = format!(
            "    <script type=\"module\" src=\"{base}@noru/client.js\"></script>\n    <link rel=\"stylesheet\" href=\"{base}assets/index.css\" data-noru-css>\n    <script type=\"module\" src=\"{base}assets/index.js\"></script>\n"
        );
        Ok(Built {
            html: rewrite_html(&project.html, &project.entries, &tags, base),
            js: bundle.js,
            css: bundle.css,
            assets: bundle.assets.into_iter().map(|f| (f.file_name, f.contents)).collect(),
            modules: bundle.modules,
            module_count: bundle.module_count,
            processed_count: bundle.processed_count,
            warnings: bundle.warnings,
        })
    }
}

/// A running dev server. Dropping it does not stop it: call [`DevServer::close`].
pub struct DevServer {
    addr: SocketAddr,
    shared: Arc<Shared>,
    watcher: Mutex<Option<RecommendedWatcher>>,
    accept_thread: Mutex<Option<JoinHandle<()>>>,
}

impl DevServer {
    /// Builds the app, starts the HTTP server and the file watcher.
    /// Build errors do not prevent the server from starting (they are shown in the browser).
    pub fn start(options: DevOptions) -> Result<DevServer, String> {
        let listener = TcpListener::bind((options.host.as_str(), options.port))
            .map_err(|e| format!("cannot listen on {}:{}: {e}", options.host, options.port))?;
        let addr = listener.local_addr().map_err(|e| e.to_string())?;
        let root = options.build.resolved_root();
        let out_dir = options.build.resolved_out_dir(&root);
        let log = options.log;

        let started = Instant::now();
        let mut builder = Builder::new(options.build.clone());
        let mut output = Output { version: 1, ..Output::default() };
        let mut module_count = 0;
        match builder.build(false) {
            Ok(built) => {
                print_warnings(log, &built.warnings);
                module_count = built.module_count;
                output.html = built.html;
                output.js = built.js;
                output.css = built.css;
                output.assets = built.assets;
                output.factories = built.modules.into_iter().map(|m| (m.id, m.factory)).collect();
            }
            Err(err) => {
                let message = strip_ansi(&err.to_string());
                if log {
                    eprintln!("{} {message}", paint("31;1", "build error:"));
                }
                output.html = fallback_html(&options.build.normalized_base());
                output.error = Some(message);
            }
        }

        let shared = Arc::new(Shared {
            output: RwLock::new(output),
            clients: Mutex::new(Vec::new()),
            public_dir: options.build.resolved_public_dir(&root),
            base: options.build.normalized_base(),
            shutdown: AtomicBool::new(false),
        });

        if log {
            let host =
                if options.host == "127.0.0.1" || options.host == "0.0.0.0" { "localhost" } else { &options.host };
            println!(
                "\n  {} {}  dev server ready in {} ms ({module_count} modules)\n\n  {}  Local:   {}\n",
                paint("36;1", "noru"),
                paint("2", &format!("v{}", crate::VERSION)),
                started.elapsed().as_millis(),
                paint("32", "➜"),
                paint("36", &format!("http://{host}:{}{}", addr.port(), shared.base)),
            );
        }

        // File watcher -> rebuild thread.
        let (tx, rx) = mpsc::channel::<notify::Result<notify::Event>>();
        let mut watcher = notify::recommended_watcher(move |event| {
            let _ = tx.send(event);
        })
        .map_err(|e| format!("cannot start file watcher: {e}"))?;
        watch_project(&mut watcher, &root, &out_dir);

        let rebuild_shared = Arc::clone(&shared);
        let rebuild_root = root.clone();
        std::thread::spawn(move || {
            while let Ok(first) = rx.recv() {
                let mut events = vec![first];
                // Debounce: editors often write a file several times in a row.
                let deadline = Instant::now() + Duration::from_millis(30);
                loop {
                    match rx.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
                        Ok(event) => events.push(event),
                        Err(RecvTimeoutError::Timeout) => break,
                        Err(RecvTimeoutError::Disconnected) => return,
                    }
                }
                let changed = relevant_paths(events, &rebuild_root, &out_dir);
                if changed.is_empty() || rebuild_shared.shutdown.load(Ordering::Relaxed) {
                    continue;
                }
                rebuild(&mut builder, &rebuild_shared, &rebuild_root, &changed, log);
            }
        });

        let accept_shared = Arc::clone(&shared);
        let accept_thread = std::thread::spawn(move || {
            for stream in listener.incoming() {
                if accept_shared.shutdown.load(Ordering::Relaxed) {
                    break;
                }
                let Ok(stream) = stream else { continue };
                let shared = Arc::clone(&accept_shared);
                std::thread::spawn(move || {
                    let _ = handle(stream, &shared);
                });
            }
        });

        Ok(DevServer {
            addr,
            shared,
            watcher: Mutex::new(Some(watcher)),
            accept_thread: Mutex::new(Some(accept_thread)),
        })
    }

    pub fn local_addr(&self) -> SocketAddr {
        self.addr
    }

    pub fn url(&self) -> String {
        format!("http://{}{}", self.addr, self.shared.base)
    }

    /// Stops watching and serving.
    pub fn close(&self) {
        self.shared.shutdown.store(true, Ordering::Relaxed);
        if let Ok(mut watcher) = self.watcher.lock() {
            watcher.take();
        }
        if let Ok(mut clients) = self.shared.clients.lock() {
            clients.clear();
        }
        // Unblock the accept loop.
        let _ = TcpStream::connect(self.addr);
        if let Some(handle) = self.accept_thread.lock().ok().and_then(|mut h| h.take()) {
            let _ = handle.join();
        }
    }

    /// Blocks until the server is closed.
    pub fn wait(&self) {
        let handle = self.accept_thread.lock().ok().and_then(|mut h| h.take());
        if let Some(handle) = handle {
            let _ = handle.join();
        }
    }
}

fn rebuild(builder: &mut Builder, shared: &Shared, root: &Path, changed: &[PathBuf], log: bool) {
    let started = Instant::now();
    let is_env = |p: &PathBuf| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with(".env"));
    let env_changed = changed.iter().any(is_env);
    let html_changed = changed.iter().any(|p| p == &root.join("index.html"));
    if env_changed {
        // Compile-time constants changed: every module must be processed again.
        builder.cache.clear();
    } else {
        builder.cache.invalidate(changed);
    }
    let names: Vec<String> = changed
        .iter()
        .take(3)
        .map(|p| p.strip_prefix(root).unwrap_or(p).to_string_lossy().replace('\\', "/"))
        .collect();
    let what = if changed.len() > 3 {
        format!("{} (+{} more)", names.join(", "), changed.len() - 3)
    } else {
        names.join(", ")
    };

    match builder.build(env_changed || html_changed) {
        Ok(built) => {
            let elapsed = started.elapsed().as_millis();
            let mut out = match shared.output.write() {
                Ok(out) => out,
                Err(poisoned) => poisoned.into_inner(),
            };
            out.error = None;
            let html_changed = out.html != built.html;
            let css_changed = out.css != built.css;
            // The page never ran a bundle (first build failed): it can only be reloaded.
            let no_previous_bundle = out.factories.is_empty();
            let changed_modules: Vec<&RenderedModule> =
                built.modules.iter().filter(|m| out.factories.get(&m.id) != Some(&m.factory)).collect();
            out.version += 1;
            let version = out.version;
            let full_reload = html_changed || env_changed || no_previous_bundle;
            if !full_reload && !changed_modules.is_empty() {
                let update = generate_hot_update(&changed_modules);
                out.updates.push_back((version, update));
                if out.updates.len() > KEPT_UPDATES {
                    out.updates.pop_front();
                }
            }
            let changed_count = changed_modules.len();
            out.factories = built.modules.iter().map(|m| (m.id, m.factory.clone())).collect();
            out.html = built.html;
            out.js = built.js;
            out.css = built.css;
            out.assets = built.assets;
            drop(out);

            let action = if full_reload {
                shared.broadcast(&serde_json::json!({ "type": "reload" }));
                "page reload".to_string()
            } else {
                let mut actions = Vec::new();
                if changed_count > 0 {
                    shared.broadcast(&serde_json::json!({ "type": "update", "version": version }));
                    actions.push(format!(
                        "hot update ({changed_count} module{})",
                        if changed_count > 1 { "s" } else { "" }
                    ));
                }
                if css_changed {
                    shared.broadcast(&serde_json::json!({ "type": "css", "version": version }));
                    actions.push("css update".to_string());
                }
                if actions.is_empty() {
                    // Saved without any effective change: nothing to tell.
                    return;
                }
                actions.join(" + ")
            };
            if log {
                print_warnings(true, &built.warnings);
                println!(
                    "{} {what} — rebuilt in {elapsed} ms ({}/{} modules) → {action}",
                    paint("36", "[noru]"),
                    built.processed_count,
                    built.module_count,
                );
            }
        }
        Err(err) => {
            let message = strip_ansi(&err.to_string());
            if log {
                eprintln!("{} {what}\n{message}", paint("31;1", "[noru] build error after changing"));
            }
            if let Ok(mut out) = shared.output.write() {
                out.error = Some(message.clone());
            }
            shared.broadcast(&serde_json::json!({ "type": "error", "message": message }));
        }
    }
}

fn watch_project(watcher: &mut RecommendedWatcher, root: &Path, out_dir: &Path) {
    // Watch the root (index.html, .env...) and every project folder except heavy/generated ones,
    // instead of the whole tree: node_modules can contain tens of thousands of folders.
    let _ = watcher.watch(root, RecursiveMode::NonRecursive);
    if let Ok(entries) = std::fs::read_dir(root) {
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if path.is_dir() && !name.starts_with('.') && !IGNORED_DIRS.contains(&name.as_str()) && path != out_dir {
                let _ = watcher.watch(&path, RecursiveMode::Recursive);
            }
        }
    }
}

fn relevant_paths(events: Vec<notify::Result<notify::Event>>, root: &Path, out_dir: &Path) -> Vec<PathBuf> {
    let mut paths: Vec<PathBuf> = events
        .into_iter()
        .flatten()
        .filter(|e| {
            matches!(e.kind, EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_) | EventKind::Any)
        })
        .flat_map(|e| e.paths)
        .filter(|p| {
            !p.starts_with(out_dir)
                && !p.components().any(|c| {
                    let s = c.as_os_str().to_string_lossy();
                    s == "node_modules" || s == ".git"
                })
                && p.file_name().and_then(|n| n.to_str()).is_some_and(|n| !n.ends_with('~') && !n.ends_with(".swp"))
                && p.starts_with(root)
                && !p.is_dir()
        })
        .collect();
    paths.sort();
    paths.dedup();
    paths
}

fn handle(mut stream: TcpStream, shared: &Shared) -> std::io::Result<()> {
    let req = read_request(&stream)?;
    let base = shared.base.as_str();
    let path = match req.path.strip_prefix(base.trim_end_matches('/')) {
        Some(rest) if rest.starts_with('/') => rest.to_string(),
        Some("") => "/".to_string(),
        _ => req.path.clone(),
    };

    match path.as_str() {
        "/@noru/events" => return events(stream, shared),
        "/@noru/client.js" => {
            return send(&mut stream, &req, dev_ok("text/javascript; charset=utf-8", CLIENT.as_bytes()));
        }
        _ => {}
    }

    let out = match shared.output.read() {
        Ok(out) => out,
        Err(poisoned) => poisoned.into_inner(),
    };
    match path.as_str() {
        "/assets/index.js" => {
            return send(&mut stream, &req, dev_ok("text/javascript; charset=utf-8", out.js.as_bytes()))
        }
        "/assets/index.css" => return send(&mut stream, &req, dev_ok("text/css; charset=utf-8", out.css.as_bytes())),
        _ => {}
    }
    // Hot update scripts: /@noru/update/<version>.js
    if let Some(version) = path.strip_prefix("/@noru/update/").and_then(|v| v.strip_suffix(".js")) {
        let script = version
            .parse::<u64>()
            .ok()
            .and_then(|v| out.updates.iter().find(|(version, _)| *version == v))
            .map(|(_, code)| code.clone())
            // Unknown (too old) update: make the client reload.
            .unwrap_or_else(|| "location.reload();\n".to_string());
        return send(&mut stream, &req, dev_ok("text/javascript; charset=utf-8", script.as_bytes()));
    }
    if let Some(bytes) = out.assets.get(path.trim_start_matches('/')) {
        let ext = extension_of(&path);
        return send(&mut stream, &req, dev_ok(mime_type(&ext), bytes));
    }
    let html = out.html.clone();
    drop(out);

    if path != "/" && path != "/index.html" {
        if let Some(file) = safe_join(&shared.public_dir, &path) {
            let body = std::fs::read(&file)?;
            let ext = file.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
            return send(&mut stream, &req, dev_ok(mime_type(&ext), &body));
        }
        if !extension_of(&path).is_empty() {
            return send(&mut stream, &req, Response::not_found());
        }
    }
    // index.html, and SPA fallback for client-side routes.
    send(&mut stream, &req, dev_ok("text/html; charset=utf-8", html.as_bytes()))
}

/// Server-Sent Events stream used by the client to receive reload / css / error messages.
fn events(mut stream: TcpStream, shared: &Shared) -> std::io::Result<()> {
    use std::io::Write;
    stream.write_all(
        b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nConnection: keep-alive\r\n\r\nretry: 1000\n\n",
    )?;
    let (tx, rx) = mpsc::channel::<String>();
    if let Ok(mut clients) = shared.clients.lock() {
        clients.push(tx);
    }
    let current_error = shared.output.read().ok().and_then(|o| o.error.clone());
    if let Some(message) = current_error {
        let payload = serde_json::json!({ "type": "error", "message": message });
        stream.write_all(format!("data: {payload}\n\n").as_bytes())?;
    }
    stream.flush()?;
    loop {
        if shared.shutdown.load(Ordering::Relaxed) {
            return Ok(());
        }
        match rx.recv_timeout(Duration::from_secs(15)) {
            Ok(message) => stream.write_all(format!("data: {message}\n\n").as_bytes())?,
            Err(RecvTimeoutError::Timeout) => stream.write_all(b": ping\n\n")?,
            Err(RecvTimeoutError::Disconnected) => return Ok(()),
        }
        stream.flush()?;
    }
}

fn fallback_html(base: &str) -> String {
    format!(
        "<!doctype html>\n<html>\n  <head>\n    <meta charset=\"UTF-8\" />\n    <title>noru</title>\n    <script type=\"module\" src=\"{base}@noru/client.js\"></script>\n  </head>\n  <body></body>\n</html>\n"
    )
}

fn print_warnings(log: bool, warnings: &[String]) {
    if log {
        for warning in warnings {
            println!("{} {warning}", paint("33;1", "warning:"));
        }
    }
}

static ANSI_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\x1b\[[0-9;]*[A-Za-z]").unwrap());

fn strip_ansi(text: &str) -> String {
    ANSI_RE.replace_all(text, "").into_owned()
}

fn paint(code: &str, text: &str) -> String {
    if std::env::var_os("NO_COLOR").is_some() {
        text.to_string()
    } else {
        format!("\x1b[{code}m{text}\x1b[0m")
    }
}

/// Dev responses: no gzip (on localhost it costs more CPU time than it saves).
fn dev_ok<'a>(content_type: &'a str, body: &'a [u8]) -> Response<'a> {
    Response { compress: false, ..Response::ok(content_type, body) }
}
