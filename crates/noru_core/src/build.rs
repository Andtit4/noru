//! `noru build`: index.html -> module graph -> bundles -> dist/.

use std::fmt;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use std::collections::HashMap;

use crate::bundle::{generate_css, generate_dev_js, generate_js, render_modules, RenderedModule};
use crate::env::{load_env, Defines};
use crate::graph::{build_graph, Context, ModuleCache};
use crate::html::{find_entries, rewrite_html, url_to_path, HtmlEntries};
use crate::module::{content_hash, EmittedFile, ModuleKey};
use crate::options::BuildOptions;
use crate::pkg::PackageCache;
use crate::resolve::NoruResolver;
use crate::treeshake::shake;

#[derive(Debug, Clone)]
pub struct OutputFile {
    /// Path relative to the output directory, with forward slashes.
    pub file_name: String,
    pub size: usize,
    pub gzip_size: usize,
}

#[derive(Debug, Clone)]
pub struct BuildResult {
    pub out_dir: PathBuf,
    pub files: Vec<OutputFile>,
    pub warnings: Vec<String>,
    pub module_count: usize,
    /// Modules left out of the bundle by tree-shaking.
    pub removed_modules: usize,
    pub duration: Duration,
}

#[derive(Debug, Clone)]
pub struct BuildError {
    pub messages: Vec<String>,
}

impl BuildError {
    pub(crate) fn one(message: impl Into<String>) -> Self {
        Self { messages: vec![message.into()] }
    }
}

impl fmt::Display for BuildError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.messages.join("\n\n"))
    }
}

impl std::error::Error for BuildError {}

/// Everything known about a project before bundling: paths, index.html entries, resolver...
pub(crate) struct Project {
    pub root: PathBuf,
    pub out_dir: PathBuf,
    pub public_dir: PathBuf,
    pub base: String,
    pub minify: bool,
    pub treeshake: bool,
    pub html: String,
    pub entries: HtmlEntries,
    entry_keys: Vec<ModuleKey>,
    style_count: usize,
    ctx: Context,
}

/// The result of bundling, in memory.
pub(crate) struct Bundle {
    pub js: String,
    pub css: String,
    pub assets: Vec<EmittedFile>,
    pub warnings: Vec<String>,
    pub module_count: usize,
    pub removed_count: usize,
}

/// Module ids that stay the same across dev rebuilds, so hot updates can target them.
#[derive(Default)]
pub(crate) struct StableIds {
    map: HashMap<ModuleKey, usize>,
    next: usize,
}

impl StableIds {
    fn get(&mut self, key: &ModuleKey) -> usize {
        if let Some(&id) = self.map.get(key) {
            return id;
        }
        let id = self.next;
        self.next += 1;
        self.map.insert(key.clone(), id);
        id
    }
}

/// The result of a development build, in memory.
pub(crate) struct DevBundle {
    pub modules: Vec<RenderedModule>,
    pub js: String,
    pub css: String,
    pub assets: Vec<EmittedFile>,
    pub warnings: Vec<String>,
    pub module_count: usize,
    pub processed_count: usize,
}

impl Project {
    /// Development bundle: no tree-shaking, stable ids, HMR runtime and React Fast Refresh.
    pub fn bundle_dev(&self, cache: &mut ModuleCache, ids: &mut StableIds) -> Result<DevBundle, BuildError> {
        let graph =
            build_graph(&self.entry_keys, &self.ctx, Some(cache)).map_err(|messages| BuildError { messages })?;
        let all_entries: Vec<usize> = (0..self.entry_keys.len()).collect();
        let shaken = shake(&graph, &all_entries, false);
        let id_of: Vec<usize> = graph.modules.iter().map(|m| ids.get(&m.key)).collect();
        let modules = render_modules(&graph, &self.root, &shaken, &|i| Some(id_of[i]), true);
        let entries: Vec<usize> = all_entries[self.style_count..].iter().map(|&e| id_of[e]).collect();
        let js = generate_dev_js(&modules, &entries);
        let css = generate_css(&graph, &all_entries, self.minify, &shaken.included);
        Ok(DevBundle {
            modules,
            js,
            css,
            assets: graph.emitted(&shaken.included),
            module_count: graph.modules.len(),
            processed_count: graph.processed_count,
            warnings: graph.warnings,
        })
    }

    pub fn load(options: &BuildOptions) -> Result<Self, BuildError> {
        let root = options.resolved_root();
        let out_dir = options.resolved_out_dir(&root);
        let public_dir = options.resolved_public_dir(&root);
        let base = options.normalized_base();

        let html_path = root.join("index.html");
        let html = std::fs::read_to_string(&html_path)
            .map_err(|_| BuildError::one(format!("no index.html found in {}", root.display())))?;
        let entries = find_entries(&html, &root, &public_dir);
        if entries.scripts.is_empty() {
            return Err(BuildError::one(
                "index.html has no <script type=\"module\" src=\"...\"> entry (e.g. <script type=\"module\" src=\"/src/main.tsx\"></script>)",
            ));
        }

        let mut entry_keys = Vec::new();
        for url in entries.styles.iter().chain(entries.scripts.iter()) {
            let path = url_to_path(&root, url);
            if !path.is_file() {
                return Err(BuildError::one(format!(
                    "entry \"{url}\" referenced in index.html does not exist ({})",
                    path.display()
                )));
            }
            entry_keys.push(ModuleKey::new(path, None));
        }

        let env = load_env(&root, &options.mode);
        let ctx = Context {
            base: base.clone(),
            public_dir: public_dir.clone(),
            minify: options.minify,
            inline_limit: options.asset_inline_limit,
            defines: Defines::build(&options.mode, &base, &env),
            resolver: NoruResolver::new(&root, options.mode == "production"),
            jsx_import_source: "react".to_string(),
            packages: PackageCache::default(),
            react_refresh: options.hmr,
        };

        Ok(Self {
            style_count: entries.styles.len(),
            root,
            out_dir,
            public_dir,
            base,
            minify: options.minify,
            treeshake: options.treeshake,
            html,
            entries,
            entry_keys,
            ctx,
        })
    }

    pub fn bundle(&self, cache: Option<&mut ModuleCache>) -> Result<Bundle, BuildError> {
        let graph = build_graph(&self.entry_keys, &self.ctx, cache).map_err(|messages| BuildError { messages })?;
        let all_entries: Vec<usize> = (0..self.entry_keys.len()).collect();
        let js_entries = &all_entries[self.style_count..];
        let shaken = shake(&graph, &all_entries, self.treeshake);
        let js = generate_js(&graph, js_entries, &self.root, self.minify, &shaken).map_err(BuildError::one)?;
        let css = generate_css(&graph, &all_entries, self.minify, &shaken.included);
        Ok(Bundle {
            js,
            css,
            assets: graph.emitted(&shaken.included),
            removed_count: shaken.removed_count(),
            module_count: graph.modules.len(),
            warnings: graph.warnings,
        })
    }
}

pub fn build(options: &BuildOptions) -> Result<BuildResult, BuildError> {
    let start = Instant::now();
    let project = Project::load(options)?;
    let bundle = project.bundle(None)?;
    let base = &project.base;

    let js_name = format!("assets/index-{}.js", content_hash(bundle.js.as_bytes()));
    let css_name =
        (!bundle.css.is_empty()).then(|| format!("assets/index-{}.css", content_hash(bundle.css.as_bytes())));
    let mut tags = format!("    <script type=\"module\" crossorigin src=\"{base}{js_name}\"></script>\n");
    if let Some(css_name) = &css_name {
        tags.push_str(&format!("    <link rel=\"stylesheet\" crossorigin href=\"{base}{css_name}\">\n"));
    }
    let html_out = rewrite_html(&project.html, &project.entries, &tags, base);

    // Write everything.
    let out_dir = &project.out_dir;
    prepare_out_dir(out_dir, &project.root, options.empty_out_dir).map_err(BuildError::one)?;
    if project.public_dir.is_dir() && !out_dir.starts_with(&project.public_dir) {
        copy_dir(&project.public_dir, out_dir).map_err(|e| BuildError::one(format!("cannot copy public dir: {e}")))?;
    }

    let mut files: Vec<EmittedFile> = Vec::new();
    files.push(EmittedFile { file_name: "index.html".into(), contents: html_out.into_bytes() });
    files.extend(bundle.assets);
    if let Some(name) = css_name {
        files.push(EmittedFile { file_name: name, contents: bundle.css.into_bytes() });
    }
    files.push(EmittedFile { file_name: js_name, contents: bundle.js.into_bytes() });

    let mut outputs = Vec::new();
    for file in &files {
        let path = out_dir.join(&file.file_name);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| BuildError::one(format!("cannot create {}: {e}", parent.display())))?;
        }
        std::fs::write(&path, &file.contents)
            .map_err(|e| BuildError::one(format!("cannot write {}: {e}", path.display())))?;
        outputs.push(OutputFile {
            file_name: file.file_name.clone(),
            size: file.contents.len(),
            gzip_size: gzip_size(&file.contents),
        });
    }

    Ok(BuildResult {
        out_dir: project.out_dir.clone(),
        files: outputs,
        warnings: bundle.warnings,
        module_count: bundle.module_count,
        removed_modules: bundle.removed_count,
        duration: start.elapsed(),
    })
}

fn prepare_out_dir(out_dir: &Path, root: &Path, empty: bool) -> Result<(), String> {
    if out_dir == root || root.starts_with(out_dir) {
        return Err(format!("refusing to use {} as output directory: it contains the project", out_dir.display()));
    }
    if empty && out_dir.exists() {
        if !out_dir.starts_with(root) {
            return Err(format!(
                "output directory {} is outside the project root; refusing to empty it",
                out_dir.display()
            ));
        }
        std::fs::remove_dir_all(out_dir).map_err(|e| format!("cannot empty {}: {e}", out_dir.display()))?;
    }
    std::fs::create_dir_all(out_dir).map_err(|e| format!("cannot create {}: {e}", out_dir.display()))
}

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

fn gzip_size(bytes: &[u8]) -> usize {
    let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    if encoder.write_all(bytes).is_err() {
        return 0;
    }
    encoder.finish().map(|v| v.len()).unwrap_or(0)
}
