//! Node.js bindings for noru (via napi-rs). Exposes `build()` / `buildSync()` to JavaScript.

use napi::bindgen_prelude::{AsyncTask, Env, Error, Result, Task};
use napi_derive::napi;

/// Options for `build()`. Every field is optional.
#[napi(object)]
#[derive(Default)]
pub struct BuildOptions {
    /// Project root, the folder containing index.html. Default: current directory.
    pub root: Option<String>,
    /// Output directory, relative to root. Default: "dist".
    pub out_dir: Option<String>,
    /// Public base path. Default: "/".
    pub base: Option<String>,
    /// Minify JS and CSS. Default: true.
    pub minify: Option<bool>,
    /// Build mode, exposed as import.meta.env.MODE. Default: "production".
    pub mode: Option<String>,
    /// Folder copied as-is to the output. Default: "public".
    pub public_dir: Option<String>,
    /// Assets smaller than this (bytes) are inlined as data URLs. Default: 4096.
    pub asset_inline_limit: Option<u32>,
    /// Empty the output directory first. Default: true.
    pub empty_out_dir: Option<bool>,
    /// Remove unused modules, exports and code. Default: true.
    pub treeshake: Option<bool>,
    /// Split the JavaScript at import() points (one chunk per Next.js page). Default: true.
    pub split: Option<bool>,
    /// Generate a service worker (offline mode, instant repeat visits). Default: true.
    pub offline: Option<bool>,
    /// Render Next.js pages to HTML at build time. Default: true.
    pub prerender: Option<bool>,
    /// Fail when a page needs more than this many kB of JS + CSS (Brotli).
    pub budget: Option<f64>,
    /// Write noru-report.html in the project root. Default: false.
    pub report: Option<bool>,
}

#[napi(object)]
pub struct OutputFile {
    /// Path relative to the output directory.
    pub file_name: String,
    pub size: u32,
    pub gzip_size: u32,
    /// Size once compressed with Brotli (0 for files not compressed).
    pub brotli_size: u32,
}

#[napi(object)]
pub struct PageWeight {
    /// Route, e.g. "/blog/[slug]".
    pub route: String,
    /// Files downloaded on a first visit (JS + CSS).
    pub files: Vec<String>,
    /// Bytes downloaded (Brotli).
    pub bytes: u32,
    /// Estimated download time on slow 3G, in milliseconds.
    #[napi(js_name = "slow3gMs")]
    pub slow_3g_ms: u32,
    /// Estimated download time on 4G, in milliseconds.
    #[napi(js_name = "fast4gMs")]
    pub fast_4g_ms: u32,
}

#[napi(object)]
pub struct BuildResult {
    pub out_dir: String,
    pub files: Vec<OutputFile>,
    pub warnings: Vec<String>,
    pub module_count: u32,
    /// Modules left out of the bundle by tree-shaking.
    pub removed_modules: u32,
    /// What each page downloads on a first visit.
    pub pages: Vec<PageWeight>,
    /// Path of noru-report.html, when asked for.
    pub report: Option<String>,
    pub duration_ms: f64,
}

fn to_core(options: Option<BuildOptions>) -> noru_core::BuildOptions {
    let o = options.unwrap_or_default();
    let mut core = noru_core::BuildOptions::new(o.root.unwrap_or_else(|| ".".to_string()));
    if let Some(v) = o.out_dir {
        core.out_dir = v.into();
    }
    if let Some(v) = o.base {
        core.base = v;
    }
    if let Some(v) = o.minify {
        core.minify = v;
    }
    if let Some(v) = o.mode {
        core.mode = v;
    }
    if let Some(v) = o.public_dir {
        core.public_dir = v.into();
    }
    if let Some(v) = o.asset_inline_limit {
        core.asset_inline_limit = v as usize;
    }
    if let Some(v) = o.empty_out_dir {
        core.empty_out_dir = v;
    }
    if let Some(v) = o.treeshake {
        core.treeshake = v;
    }
    if let Some(v) = o.split {
        core.split = v;
    }
    if let Some(v) = o.offline {
        core.offline = v;
    }
    if let Some(v) = o.prerender {
        core.prerender = v;
    }
    core.budget_kb = o.budget;
    if let Some(v) = o.report {
        core.report = v;
    }
    core
}

fn to_js(result: noru_core::BuildResult) -> BuildResult {
    BuildResult {
        out_dir: result.out_dir.to_string_lossy().into_owned(),
        files: result
            .files
            .into_iter()
            .map(|f| OutputFile {
                file_name: f.file_name,
                size: f.size as u32,
                gzip_size: f.gzip_size as u32,
                brotli_size: f.brotli_size as u32,
            })
            .collect(),
        pages: result
            .pages
            .iter()
            .map(|p| PageWeight {
                route: p.route.clone(),
                files: p.files.clone(),
                bytes: p.bytes as u32,
                slow_3g_ms: p.slow_3g_ms() as u32,
                fast_4g_ms: p.fast_4g_ms() as u32,
            })
            .collect(),
        report: result.report.map(|p| p.to_string_lossy().into_owned()),
        warnings: result.warnings,
        module_count: result.module_count as u32,
        removed_modules: result.removed_modules as u32,
        duration_ms: result.duration.as_secs_f64() * 1000.0,
    }
}

fn run(options: &noru_core::BuildOptions) -> Result<noru_core::BuildResult> {
    noru_core::build(options).map_err(|e| Error::from_reason(e.to_string()))
}

pub struct BuildTask {
    options: noru_core::BuildOptions,
}

impl Task for BuildTask {
    type Output = noru_core::BuildResult;
    type JsValue = BuildResult;

    fn compute(&mut self) -> Result<Self::Output> {
        run(&self.options)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(to_js(output))
    }
}

/// Builds the app for production on a background thread. Rejects with the build errors on failure.
#[napi(ts_return_type = "Promise<BuildResult>")]
pub fn build(options: Option<BuildOptions>) -> AsyncTask<BuildTask> {
    AsyncTask::new(BuildTask { options: to_core(options) })
}

/// Synchronous version of `build()`.
#[napi]
pub fn build_sync(options: Option<BuildOptions>) -> Result<BuildResult> {
    run(&to_core(options)).map(to_js)
}

/// Options for `startPlayServer()`. Every field is optional.
#[napi(object)]
#[derive(Default)]
pub struct PlayServerOptions {
    /// Port. Default: 4040 (0 picks a free port).
    pub port: Option<u32>,
    /// Host. Default: "0.0.0.0".
    pub host: Option<String>,
    /// Players per room. Default: 16.
    pub max_players: Option<u32>,
    /// Origins of the websites allowed to connect, e.g. ["https://example.com"]. Default: any.
    pub allowed_origins: Option<Vec<String>>,
}

/// A running multiplayer rooms server (noru play).
#[napi]
pub struct PlayServer {
    inner: noru_core::PlayServer,
}

#[napi]
impl PlayServer {
    #[napi(getter)]
    pub fn port(&self) -> u32 {
        u32::from(self.inner.local_addr().port())
    }

    /// Number of rooms open now.
    #[napi(getter)]
    pub fn rooms(&self) -> u32 {
        self.inner.counts().0 as u32
    }

    /// Number of players connected now.
    #[napi(getter)]
    pub fn players(&self) -> u32 {
        self.inner.counts().1 as u32
    }

    #[napi]
    pub fn close(&self) {
        self.inner.close();
    }
}

/// Starts the multiplayer rooms server of noru-play games (WebSocket, `webSocketTransport`).
#[napi]
pub fn start_play_server(options: Option<PlayServerOptions>) -> Result<PlayServer> {
    let o = options.unwrap_or_default();
    let port = u16::try_from(o.port.unwrap_or(4040)).map_err(|_| Error::from_reason("invalid port"))?;
    let host = o.host.unwrap_or_else(|| "0.0.0.0".to_string());
    let config = noru_core::RoomsConfig {
        max_players: o.max_players.map_or(16, |n| n.max(1) as usize),
        allowed_origins: o.allowed_origins.unwrap_or_default(),
    };
    let inner = noru_core::PlayServer::start(&host, port, config)
        .map_err(|e| Error::from_reason(format!("cannot listen on {host}:{port}: {e}")))?;
    Ok(PlayServer { inner })
}

/// Options for `startDevServer()`. Every field is optional.
#[napi(object)]
#[derive(Default)]
pub struct DevOptions {
    /// Project root, the folder containing index.html. Default: current directory.
    pub root: Option<String>,
    /// Port. Default: 3000 (0 picks a free port).
    pub port: Option<u32>,
    /// Host. Default: "127.0.0.1" (use "0.0.0.0" to expose on the network).
    pub host: Option<String>,
    /// Public base path. Default: "/".
    pub base: Option<String>,
    /// Mode, exposed as import.meta.env.MODE. Default: "development".
    pub mode: Option<String>,
    /// Folder served as-is. Default: "public".
    pub public_dir: Option<String>,
    /// Print startup and rebuild logs. Default: true.
    pub log: Option<bool>,
}

/// A running development server.
#[napi]
pub struct DevServer {
    inner: noru_core::DevServer,
}

#[napi]
impl DevServer {
    /// URL of the server, e.g. "http://127.0.0.1:3000/".
    #[napi(getter)]
    pub fn url(&self) -> String {
        self.inner.url()
    }

    #[napi(getter)]
    pub fn port(&self) -> u32 {
        u32::from(self.inner.local_addr().port())
    }

    /// Stops the server and the file watcher.
    #[napi]
    pub fn close(&self) {
        self.inner.close();
    }
}

/// Starts the development server: the whole app is bundled in memory up-front, then only changed
/// files are re-processed and browsers reload automatically.
#[napi]
pub fn start_dev_server(options: Option<DevOptions>) -> Result<DevServer> {
    let o = options.unwrap_or_default();
    let mut dev = noru_core::DevOptions::new(o.root.unwrap_or_else(|| ".".to_string()));
    if let Some(port) = o.port {
        dev.port = u16::try_from(port).map_err(|_| Error::from_reason(format!("invalid port {port}")))?;
    }
    if let Some(v) = o.host {
        dev.host = v;
    }
    if let Some(v) = o.base {
        dev.build.base = v;
    }
    if let Some(v) = o.mode {
        dev.build.mode = v;
    }
    if let Some(v) = o.public_dir {
        dev.build.public_dir = v.into();
    }
    if let Some(v) = o.log {
        dev.log = v;
    }
    let inner = noru_core::DevServer::start(dev).map_err(Error::from_reason)?;
    Ok(DevServer { inner })
}

/// Version of the native noru core.
#[napi]
pub fn core_version() -> String {
    noru_core::VERSION.to_string()
}
