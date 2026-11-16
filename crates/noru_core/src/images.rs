//! Images of Next.js apps (`import photo from "./photo.jpg"`, used by next/image):
//! - always: width and height read from the file (no layout shift);
//! - production builds, when `sharp` is installed (Next.js installs it): a tiny blurred preview
//!   (`placeholder="blur"`) and AVIF / WebP versions in several widths, so that phones on a slow
//!   connection download a small modern file instead of the original.
//!
//! Encoded files are kept in `node_modules/.noru-cache/images/`: later builds reuse them.

use std::ffi::OsString;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::Mutex;

const WORKER: &str = include_str!("image-worker.js");
const MARKER: &str = "\u{0}noru-image:";

/// Widths generated for responsive images (plus the original width when smaller than the largest).
const WIDTHS: &[u32] = &[384, 640, 828, 1080, 1200, 1920, 2560];

/// Formats sharp can read and that are worth converting.
fn optimizable(ext: &str) -> bool {
    matches!(ext, "png" | "jpg" | "jpeg" | "jfif" | "webp" | "avif" | "tif" | "tiff")
}

/// Width and height of an image file, read from its header.
pub fn dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    let size = imagesize::blob_size(bytes).ok()?;
    Some((size.width as u32, size.height as u32))
}

pub struct ImageOptimizer {
    root: PathBuf,
    cache_dir: PathBuf,
    worker: Mutex<Option<Worker>>,
    /// Encoded files to copy to the build output (names in the cache = names in `assets/`).
    outputs: Mutex<Vec<String>>,
    failed: Mutex<bool>,
}

/// What an image import becomes, on top of its URL and dimensions.
pub struct Optimized {
    pub blur: Option<(String, u32, u32)>,
    /// `{ avif: "url 640w, ...", webp: "..." }`
    pub sources: Option<serde_json::Value>,
}

struct Worker {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl Drop for Worker {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Worker {
    fn spawn(root: &Path, cache_dir: &Path) -> Result<Self, String> {
        let node = std::env::var_os("NORU_NODE").unwrap_or_else(|| OsString::from("node"));
        let threads = std::thread::available_parallelism().map_or(4, |n| n.get()).max(4);
        let mut child = Command::new(&node)
            .arg("-e")
            .arg(WORKER)
            .arg(root)
            .arg(cache_dir)
            .current_dir(root)
            .env("UV_THREADPOOL_SIZE", threads.to_string())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|e| format!("cannot start Node.js for image optimization: {e}"))?;
        let stdin = child.stdin.take().ok_or("image worker has no stdin")?;
        let stdout = BufReader::new(child.stdout.take().ok_or("image worker has no stdout")?);
        Ok(Self { child, stdin, stdout })
    }

    fn request(&mut self, request: &serde_json::Value) -> Result<serde_json::Value, String> {
        let io = |e: std::io::Error| format!("image worker: {e}");
        self.stdin.write_all(request.to_string().as_bytes()).map_err(io)?;
        self.stdin.write_all(b"\n").map_err(io)?;
        self.stdin.flush().map_err(io)?;
        loop {
            let mut line = String::new();
            if self.stdout.read_line(&mut line).map_err(io)? == 0 {
                return Err("the image worker (Node.js) stopped unexpectedly".to_string());
            }
            if let Some(json) = line.trim_end().strip_prefix(MARKER) {
                let answer: serde_json::Value =
                    serde_json::from_str(json).map_err(|e| format!("image worker: invalid answer: {e}"))?;
                if let Some(error) = answer.get("error").and_then(|e| e.as_str()) {
                    return Err(error.to_string());
                }
                return Ok(answer);
            }
        }
    }
}

impl ImageOptimizer {
    /// Available when the project has `sharp` (directly or through Next.js).
    pub fn detect(root: &Path) -> Option<Self> {
        let candidates = [root.join("node_modules/sharp"), root.join("node_modules/next/node_modules/sharp")];
        if !candidates.iter().any(|dir| dir.join("package.json").is_file()) {
            return None;
        }
        Some(Self {
            root: root.to_path_buf(),
            cache_dir: root.join("node_modules/.noru-cache/images"),
            worker: Mutex::new(None),
            outputs: Mutex::new(Vec::new()),
            failed: Mutex::new(false),
        })
    }

    fn request(&self, request: serde_json::Value) -> Option<serde_json::Value> {
        if *self.failed.lock().ok()? {
            return None;
        }
        let mut guard = self.worker.lock().unwrap_or_else(|p| p.into_inner());
        if guard.is_none() {
            match Worker::spawn(&self.root, &self.cache_dir) {
                Ok(worker) => *guard = Some(worker),
                Err(_) => {
                    *self.failed.lock().ok()? = true;
                    return None;
                }
            }
        }
        match guard.as_mut()?.request(&request) {
            Ok(answer) => Some(answer),
            Err(_) => {
                *guard = None;
                if let Ok(mut failed) = self.failed.lock() {
                    *failed = true;
                }
                None
            }
        }
    }

    /// Blur preview + responsive AVIF / WebP versions of an imported image.
    /// `stem` and `hash` are those of the emitted original (`assets/<stem>-<hash>.<ext>`).
    pub fn optimize(&self, path: &Path, ext: &str, stem: &str, hash: &str, width: u32, base: &str) -> Optimized {
        if !optimizable(ext) {
            return Optimized { blur: None, sources: None };
        }
        let blur = self.request(serde_json::json!({ "type": "blur", "file": path })).and_then(|answer| {
            Some((
                answer.get("blur")?.as_str()?.to_string(),
                answer.get("width")?.as_u64()? as u32,
                answer.get("height")?.as_u64()? as u32,
            ))
        });
        let mut widths: Vec<u32> = WIDTHS.iter().copied().filter(|&w| w < width).collect();
        if width <= *WIDTHS.last().unwrap_or(&2560) {
            widths.push(width);
        } else if widths.last() != WIDTHS.last() {
            widths.extend(WIDTHS.last());
        }
        let mut outputs = Vec::new();
        let mut sources = serde_json::Map::new();
        for format in ["avif", "webp"] {
            let mut set = Vec::new();
            for &w in &widths {
                let name = format!("{stem}-{w}w-{hash}.{format}");
                set.push(format!("{base}assets/{name} {w}w"));
                outputs.push(serde_json::json!({ "name": name, "width": w, "format": format }));
            }
            sources.insert(format.to_string(), serde_json::Value::String(set.join(", ")));
        }
        let started = self.request(serde_json::json!({ "type": "variants", "file": path, "outputs": outputs }));
        let sources = started.map(|_| {
            if let Ok(mut list) = self.outputs.lock() {
                list.extend(outputs.iter().filter_map(|o| o.get("name")?.as_str().map(String::from)));
            }
            serde_json::Value::Object(sources)
        });
        Optimized { blur, sources }
    }

    /// Waits for every encoding and returns the files to write (`assets/<name>`, contents).
    pub fn finish(&self) -> (Vec<crate::module::EmittedFile>, Vec<String>) {
        let mut warnings = Vec::new();
        let names: Vec<String> = self.outputs.lock().map(|mut list| std::mem::take(&mut *list)).unwrap_or_default();
        if names.is_empty() {
            return (Vec::new(), warnings);
        }
        match self.request(serde_json::json!({ "type": "finish" })) {
            Some(answer) => {
                for error in answer.get("errors").and_then(|e| e.as_array()).into_iter().flatten() {
                    warnings.push(format!("image optimization failed: {}", error.as_str().unwrap_or("")));
                }
            }
            None => warnings.push("image optimization (sharp) failed: images are served as they are".to_string()),
        }
        let mut files = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for name in names {
            if !seen.insert(name.clone()) {
                continue;
            }
            if let Ok(contents) = std::fs::read(self.cache_dir.join(&name)) {
                files.push(crate::module::EmittedFile { file_name: format!("assets/{name}"), contents });
            }
        }
        (files, warnings)
    }
}
