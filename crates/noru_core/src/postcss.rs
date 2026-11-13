//! PostCSS support (Tailwind CSS, autoprefixer...) for projects with a `postcss.config.*` file.
//!
//! PostCSS plugins are JavaScript, so CSS files are sent to a long-lived Node.js process that
//! runs the project's own PostCSS setup (`postcss-worker.js`). Keeping it alive keeps Tailwind's
//! caches warm: re-generating the CSS after an edit takes milliseconds.

use std::collections::HashSet;
use std::ffi::OsString;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Arc, Mutex};

const WORKER: &str = include_str!("postcss-worker.js");
const MARKER: &str = "\u{0}noru-postcss:";

const CONFIG_FILES: &[&str] = &[
    "postcss.config.mjs",
    "postcss.config.js",
    "postcss.config.cjs",
    "postcss.config.mts",
    "postcss.config.ts",
    ".postcssrc.json",
    ".postcssrc",
];

/// Tailwind syntax (v3 and v4).
const TAILWIND_MARKERS: &[&str] = &[
    "@tailwind",
    "@apply",
    "@layer",
    "@config",
    "@plugin",
    "@theme",
    "@variant",
    "@custom-variant",
    "@utility",
    "@source",
    "@reference",
    "@screen",
    "theme(",
    "--theme(",
    "tailwindcss",
];

/// PostCSS plugins whose only job, outside Tailwind syntax, is done by Lightning CSS or not needed.
const TAILWIND_COMPANIONS: &[&str] = &[
    "tailwindcss",
    "@tailwindcss/postcss",
    "tailwindcss/nesting",
    "autoprefixer",
    "postcss-import",
    "postcss-nesting",
];

/// The config only uses Tailwind and its usual companions.
fn is_tailwind_only(config: &str) -> bool {
    if !config.contains("tailwind") {
        return false;
    }
    // Every quoted name or object key in the config that looks like a plugin must be a known one.
    let names = regex::Regex::new(r#"["']([@a-zA-Z0-9/_.-]+)["']|([A-Za-z_$][\w$]*)\s*:"#).expect("valid regex");
    let known = names.captures_iter(config).all(|c| {
        let name = c.get(1).or(c.get(2)).map_or("", |m| m.as_str());
        !(name.contains("postcss") || name.contains("tailwind") || name.contains("prefixer") || name.contains('/'))
            || TAILWIND_COMPANIONS.contains(&name)
            || name.starts_with("./")
    });
    known
}

pub struct PostCss {
    root: PathBuf,
    config: PathBuf,
    /// The config only has Tailwind and plugins that are not needed by stylesheets without Tailwind
    /// syntax (autoprefixer, nesting...): those stylesheets skip PostCSS.
    tailwind_only: bool,
    worker: Arc<Mutex<Option<Worker>>>,
    /// CSS files that went through PostCSS (Tailwind output depends on the other source files).
    processed: Mutex<HashSet<PathBuf>>,
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
    fn spawn(root: &Path, config: &Path) -> Result<Self, String> {
        // The npm package sets NORU_NODE to the Node.js running it.
        let node = std::env::var_os("NORU_NODE").unwrap_or_else(|| OsString::from("node"));
        let mut child = Command::new(&node)
            .arg("-e")
            .arg(WORKER)
            .arg(root)
            .arg(config)
            .current_dir(root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|e| {
                format!(
                    "{} needs Node.js to run PostCSS / Tailwind, but `{}` could not be started: {e}",
                    config.display(),
                    node.to_string_lossy()
                )
            })?;
        let stdin = child.stdin.take().ok_or("PostCSS worker has no stdin")?;
        let stdout = BufReader::new(child.stdout.take().ok_or("PostCSS worker has no stdout")?);
        Ok(Self { child, stdin, stdout })
    }

    fn request(&mut self, request: &str) -> Result<serde_json::Value, String> {
        let io = |e: std::io::Error| format!("PostCSS worker: {e}");
        self.stdin.write_all(request.as_bytes()).map_err(io)?;
        self.stdin.write_all(b"\n").map_err(io)?;
        self.stdin.flush().map_err(io)?;
        loop {
            let mut line = String::new();
            if self.stdout.read_line(&mut line).map_err(io)? == 0 {
                return Err("the PostCSS worker (Node.js) stopped unexpectedly, see the messages above".to_string());
            }
            if let Some(json) = line.trim_end().strip_prefix(MARKER) {
                return serde_json::from_str(json).map_err(|e| format!("PostCSS worker: invalid answer: {e}"));
            }
        }
    }
}

impl PostCss {
    /// Finds the PostCSS config of a project.
    pub fn detect(root: &Path) -> Option<Self> {
        let config = CONFIG_FILES.iter().map(|name| root.join(name)).find(|p| p.is_file())?;
        let text = std::fs::read_to_string(&config).unwrap_or_default();
        let postcss = Self {
            root: root.to_path_buf(),
            tailwind_only: is_tailwind_only(&text),
            config,
            worker: Arc::new(Mutex::new(None)),
            processed: Mutex::new(HashSet::new()),
        };
        postcss.warm_up();
        Some(postcss)
    }

    /// Whether a stylesheet must go through PostCSS. In Tailwind projects, Tailwind only matters for
    /// stylesheets that use its syntax: the others (often big generated files) skip the round-trip.
    pub fn wants(&self, css: &str) -> bool {
        !self.tailwind_only || TAILWIND_MARKERS.iter().any(|marker| css.contains(marker))
    }

    /// Starts Node.js and loads the PostCSS plugins in the background, while the JavaScript of the
    /// project is being processed (saves the start-up time of the first stylesheet).
    fn warm_up(&self) {
        let (worker, root, config) = (Arc::clone(&self.worker), self.root.clone(), self.config.clone());
        std::thread::spawn(move || {
            let mut guard = worker.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            if guard.is_none() {
                *guard = Worker::spawn(&root, &config).ok();
            }
            let request = serde_json::json!({ "file": root.join("__noru_warm_up__.css"), "css": "" }).to_string();
            if let Some(Err(_)) = guard.as_mut().map(|w| w.request(&request)) {
                *guard = None;
            }
        });
    }

    pub fn processed_files(&self) -> Vec<PathBuf> {
        self.processed.lock().map(|set| set.iter().cloned().collect()).unwrap_or_default()
    }

    /// Runs the project's PostCSS plugins on a CSS file.
    pub fn process(&self, path: &Path, css: &str) -> Result<(String, Vec<String>), String> {
        if let Ok(mut set) = self.processed.lock() {
            set.insert(path.to_path_buf());
        }
        let request = serde_json::json!({ "file": path, "css": css }).to_string();
        let mut guard = self.worker.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if guard.is_none() {
            *guard = Some(Worker::spawn(&self.root, &self.config)?);
        }
        let answer = match guard.as_mut().map(|worker| worker.request(&request)) {
            Some(Ok(answer)) => answer,
            Some(Err(e)) => {
                *guard = None; // start a new worker next time
                return Err(e);
            }
            None => unreachable!("worker started above"),
        };
        drop(guard);
        if let Some(error) = answer.get("error").and_then(|e| e.as_str()) {
            return Err(format!("PostCSS error in {}:\n{error}", path.display()));
        }
        let code = answer.get("css").and_then(|c| c.as_str()).unwrap_or_default().to_string();
        let warnings = answer
            .get("warnings")
            .and_then(|w| w.as_array())
            .map(|list| list.iter().filter_map(|w| w.as_str()).map(|w| format!("PostCSS: {w}")).collect())
            .unwrap_or_default();
        Ok((code, warnings))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_tailwind_only_configs() {
        assert!(is_tailwind_only("export default { plugins: { '@tailwindcss/postcss': {} } }"));
        assert!(is_tailwind_only(
            "module.exports = { plugins: { 'tailwindcss/nesting': {}, tailwindcss: {}, autoprefixer: {} } }"
        ));
        assert!(is_tailwind_only(
            "const config = { plugins: [\"tailwindcss\", \"autoprefixer\"] }; export default config"
        ));
        assert!(!is_tailwind_only("module.exports = { plugins: { tailwindcss: {}, 'postcss-preset-env': {} } }"));
        assert!(!is_tailwind_only("module.exports = { plugins: { autoprefixer: {} } }"));
    }
}
