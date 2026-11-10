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
}

#[napi(object)]
pub struct OutputFile {
    /// Path relative to the output directory.
    pub file_name: String,
    pub size: u32,
    pub gzip_size: u32,
}

#[napi(object)]
pub struct BuildResult {
    pub out_dir: String,
    pub files: Vec<OutputFile>,
    pub warnings: Vec<String>,
    pub module_count: u32,
    /// Modules left out of the bundle by tree-shaking.
    pub removed_modules: u32,
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
    core
}

fn to_js(result: noru_core::BuildResult) -> BuildResult {
    BuildResult {
        out_dir: result.out_dir.to_string_lossy().into_owned(),
        files: result
            .files
            .into_iter()
            .map(|f| OutputFile { file_name: f.file_name, size: f.size as u32, gzip_size: f.gzip_size as u32 })
            .collect(),
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
