use std::path::{Path, PathBuf};

/// Options for a production build.
#[derive(Debug, Clone)]
pub struct BuildOptions {
    /// Project root (the folder that contains `index.html`).
    pub root: PathBuf,
    /// Output directory, relative to `root` (or absolute). Default: `dist`.
    pub out_dir: PathBuf,
    /// Public base path the app is served from. Default: `/`.
    pub base: String,
    /// Minify JS and CSS. Default: `true`.
    pub minify: bool,
    /// Build mode, exposed as `import.meta.env.MODE`. Default: `production`.
    pub mode: String,
    /// Folder whose files are copied as-is to the output. Default: `public`.
    pub public_dir: PathBuf,
    /// Assets smaller than this many bytes are inlined as base64 data URLs. Default: 4096.
    pub asset_inline_limit: usize,
    /// Empty the output directory before writing. Default: `true`.
    pub empty_out_dir: bool,
    /// Remove unused modules, exports and code from the bundle. Default: `true`.
    pub treeshake: bool,
    /// Development: hot module replacement + React Fast Refresh. Default: `false`.
    pub hmr: bool,
}

impl BuildOptions {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self {
            root: root.into(),
            out_dir: PathBuf::from("dist"),
            base: "/".to_string(),
            minify: true,
            mode: "production".to_string(),
            public_dir: PathBuf::from("public"),
            asset_inline_limit: 4096,
            empty_out_dir: true,
            treeshake: true,
            hmr: false,
        }
    }

    pub(crate) fn resolved_root(&self) -> PathBuf {
        normalize_path(&absolutize(&self.root, &std::env::current_dir().unwrap_or_default()))
    }

    pub(crate) fn resolved_out_dir(&self, root: &Path) -> PathBuf {
        normalize_path(&absolutize(&self.out_dir, root))
    }

    pub(crate) fn resolved_public_dir(&self, root: &Path) -> PathBuf {
        normalize_path(&absolutize(&self.public_dir, root))
    }

    /// `base` always starts and ends with `/` (unless it is a full URL or empty-relative `./`).
    pub(crate) fn normalized_base(&self) -> String {
        let mut base = self.base.trim().to_string();
        if base.is_empty() {
            base = "/".to_string();
        }
        if !base.ends_with('/') {
            base.push('/');
        }
        if !base.starts_with('/') && !base.starts_with("./") && !base.contains("://") {
            base.insert(0, '/');
        }
        base
    }
}

fn absolutize(path: &Path, base: &Path) -> PathBuf {
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        base.join(path)
    }
}

/// Lexically normalizes a path (removes `.` and resolves `..`) without touching the file system.
pub(crate) fn normalize_path(path: &Path) -> PathBuf {
    use std::path::Component;
    let mut out = PathBuf::new();
    for comp in path.components() {
        match comp {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}
