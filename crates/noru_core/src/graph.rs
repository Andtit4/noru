//! The module graph: discovers every file reachable from the entries and processes them in parallel.
//!
//! Discovery is breadth-first, level by level. All modules of a level are processed concurrently
//! (rayon), then their newly discovered dependencies form the next level. Ids are assigned in a
//! deterministic order so that the output is identical from one build to the next.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::SystemTime;

use rayon::prelude::*;

use crate::asset::{is_asset_extension, process_asset, AssetOptions};
use crate::css::process_css;
use crate::env::Defines;
use crate::js::{process_js, EsmInfo, JsContext, Segment};
use crate::module::{EmittedFile, ModuleKey};
use crate::pkg::PackageCache;
use crate::resolve::{NoruResolver, ResolveKind};

pub struct Context {
    pub base: String,
    pub public_dir: PathBuf,
    pub minify: bool,
    pub inline_limit: usize,
    pub defines: Defines,
    pub resolver: NoruResolver,
    pub jsx_import_source: String,
    pub packages: PackageCache,
    pub react_refresh: bool,
}

/// Query marker for imports of files in the public directory (`import logo from '/vite.svg'`).
const PUBLIC_QUERY: &str = "?noru-public";

impl JsContext for Context {
    fn defines(&self) -> &Defines {
        &self.defines
    }

    fn react_refresh(&self) -> bool {
        self.react_refresh
    }

    fn jsx_import_source(&self) -> &str {
        &self.jsx_import_source
    }

    fn resolve(
        &self,
        importer: &Path,
        specifier: &str,
        kind: ResolveKind,
    ) -> Result<(ModuleKey, Option<String>), String> {
        // `/file` that exists in public/ is served as-is: importing it gives its URL.
        if let Some(rest) = specifier.strip_prefix('/').filter(|r| !r.starts_with('/')) {
            let clean = rest.split(['?', '#']).next().unwrap_or(rest);
            let candidate = self.public_dir.join(clean);
            if candidate.is_file() {
                return Ok((ModuleKey::new(candidate, Some(PUBLIC_QUERY.to_string())), None));
            }
        }
        self.resolver.resolve(importer, specifier, kind).map(|r| (r.key, r.warning))
    }
}

impl Context {
    fn public_url(&self, path: &Path) -> String {
        let rel = path.strip_prefix(&self.public_dir).unwrap_or(path);
        format!("{}{}", self.base, rel.to_string_lossy().replace('\\', "/"))
    }
}

/// A processed JavaScript module, turned into a factory function by the linker.
pub struct JsModule {
    pub segments: Vec<Segment>,
    /// Import/export/statement information for ES modules (`None` for CommonJS).
    pub esm: Option<EsmInfo>,
    /// From the package's `"sideEffects"` field, when it says something about this file.
    pub side_effects_hint: Option<bool>,
    /// Compiled with React Refresh registrations (dev server).
    pub refresh: bool,
}

pub enum ModuleOutput {
    /// JavaScript (ES module or CommonJS).
    Js(JsModule),
    /// A stylesheet. Its JS factory is empty, or exports the class names of a CSS module.
    Css { code: String, module_exports: Option<String> },
    /// A ready-made JS factory function (assets, JSON, raw text...).
    Static(String),
}

pub struct Module {
    pub key: ModuleKey,
    pub processed: Arc<Processed>,
    /// Ids of the dependencies, aligned with the `Part::Dep(i)` indices of the template.
    pub deps: Vec<usize>,
}

impl Module {
    pub fn output(&self) -> &ModuleOutput {
        &self.processed.output
    }
}

pub struct Graph {
    pub modules: Vec<Module>,
    pub warnings: Vec<String>,
    /// How many modules were (re)processed, i.e. not taken from the cache.
    pub processed_count: usize,
}

impl Graph {
    /// Asset files emitted by the included modules, deduplicated and sorted by name.
    pub fn emitted(&self, included: &[bool]) -> Vec<EmittedFile> {
        let mut files: Vec<EmittedFile> = self
            .modules
            .iter()
            .enumerate()
            .filter(|(id, _)| included[*id])
            .flat_map(|(_, m)| m.processed.emitted.iter().cloned())
            .collect();
        files.sort_by(|a, b| a.file_name.cmp(&b.file_name));
        files.dedup_by(|a, b| a.file_name == b.file_name);
        files
    }
}

pub struct Processed {
    output: ModuleOutput,
    deps: Vec<ModuleKey>,
    emitted: Vec<EmittedFile>,
    warnings: Vec<String>,
}

impl Processed {
    fn simple(factory: String) -> Self {
        Self { output: ModuleOutput::Static(factory), deps: vec![], emitted: vec![], warnings: vec![] }
    }
}

fn exports_factory(value_js: &str) -> String {
    format!("function(module) {{ module.exports = {value_js}; }}")
}

fn read_text(path: &Path) -> Result<String, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    Ok(match text.strip_prefix('\u{feff}') {
        Some(rest) => rest.to_string(),
        None => text,
    })
}

fn process_module(key: &ModuleKey, ctx: &Context) -> Result<Processed, String> {
    if key.is_empty_module() {
        return Ok(Processed::simple("function() {}".to_string()));
    }
    let path = key.path.as_path();
    let assets = AssetOptions { base: &ctx.base, inline_limit: ctx.inline_limit };
    let ext = key.extension();

    if key.query.as_deref() == Some(PUBLIC_QUERY) {
        let url = ctx.public_url(path);
        return Ok(Processed::simple(exports_factory(&serde_json::to_string(&url).unwrap_or_default())));
    }
    if key.has_query("raw") {
        let text = read_text(path)?;
        return Ok(Processed::simple(exports_factory(&serde_json::to_string(&text).unwrap_or_default())));
    }
    if key.has_query("url") {
        let (url, file) = process_asset(path, &AssetOptions { inline_limit: 0, ..assets })?;
        let mut p = Processed::simple(exports_factory(&serde_json::to_string(&url).unwrap_or_default()));
        p.emitted.extend(file);
        return Ok(p);
    }

    match ext.as_str() {
        "js" | "mjs" | "cjs" | "jsx" | "ts" | "tsx" | "mts" | "cts" => {
            let source = read_text(path)?;
            let out = process_js(key, &source, ctx)?;
            let module = JsModule {
                segments: out.segments,
                esm: out.esm,
                side_effects_hint: ctx.packages.side_effects(path),
                refresh: out.refresh,
            };
            Ok(Processed { output: ModuleOutput::Js(module), deps: out.deps, emitted: vec![], warnings: out.warnings })
        }
        "css" => {
            let source = read_text(path)?;
            let resolve = |specifier: &str| ctx.resolver.resolve(path, specifier, ResolveKind::Css).map(|r| r.key);
            let out = process_css(path, &source, ctx.minify, &assets, &resolve)?;
            if key.has_query("inline") {
                let mut p = Processed::simple(exports_factory(&serde_json::to_string(&out.code).unwrap_or_default()));
                p.emitted = out.emitted;
                p.warnings = out.warnings;
                return Ok(p);
            }
            Ok(Processed {
                output: ModuleOutput::Css { code: out.code, module_exports: out.module_exports },
                deps: out.imports,
                emitted: out.emitted,
                warnings: out.warnings,
            })
        }
        "json" => {
            let text = read_text(path)?;
            let value: serde_json::Value =
                serde_json::from_str(&text).map_err(|e| format!("invalid JSON in {}: {e}", path.display()))?;
            Ok(Processed::simple(exports_factory(&value.to_string())))
        }
        "scss" | "sass" | "less" | "styl" | "stylus" => Err(format!(
            "{} : CSS preprocessors (.{ext}) are not supported yet — use plain .css for now",
            path.display()
        )),
        "vue" | "svelte" | "astro" => Err(format!(
            "{} : .{ext} files are not supported yet (noru v0.1 supports React/JSX/TypeScript)",
            path.display()
        )),
        _ if is_asset_extension(&ext) => {
            let (url, file) = process_asset(path, &assets)?;
            let mut p = Processed::simple(exports_factory(&serde_json::to_string(&url).unwrap_or_default()));
            p.emitted.extend(file);
            Ok(p)
        }
        _ => Err(format!("{} : unsupported file type \".{ext}\"", path.display())),
    }
}

/// Last-modified time + size of a file: if both are unchanged, the cached result is reused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct FileStamp {
    modified: Option<SystemTime>,
    len: u64,
}

fn file_stamp(key: &ModuleKey) -> Option<FileStamp> {
    if key.is_empty_module() {
        return Some(FileStamp { modified: None, len: 0 });
    }
    let meta = std::fs::metadata(&key.path).ok()?;
    Some(FileStamp { modified: meta.modified().ok(), len: meta.len() })
}

/// Outcome of processing one module: id, file stamp, whether it came from the cache, result.
type LevelResult = (usize, Option<FileStamp>, bool, Result<Arc<Processed>, String>);

/// Processed modules kept between builds (dev server): only changed files are processed again.
#[derive(Default)]
pub struct ModuleCache {
    entries: HashMap<ModuleKey, (FileStamp, Arc<Processed>)>,
}

impl ModuleCache {
    pub fn clear(&mut self) {
        self.entries.clear();
    }

    /// Forgets the given files, whatever their timestamps say (file systems may update
    /// modification times lazily, so a watcher event is a more reliable signal).
    pub fn invalidate(&mut self, paths: &[PathBuf]) {
        self.entries.retain(|key, _| !paths.contains(&key.path));
    }
}

pub fn build_graph(
    entries: &[ModuleKey],
    ctx: &Context,
    cache: Option<&mut ModuleCache>,
) -> Result<Graph, Vec<String>> {
    let mut index: HashMap<ModuleKey, usize> = HashMap::new();
    let mut keys: Vec<ModuleKey> = Vec::new();
    let mut slots: Vec<Option<Module>> = Vec::new();
    let mut frontier = Vec::new();

    for entry in entries {
        if !index.contains_key(entry) {
            index.insert(entry.clone(), keys.len());
            frontier.push(keys.len());
            keys.push(entry.clone());
            slots.push(None);
        }
    }

    let mut cache = cache;
    let mut errors = Vec::new();
    let mut warnings = Vec::new();
    let mut processed_count = 0;

    while !frontier.is_empty() {
        let cache_ref = cache.as_deref();
        let results: Vec<LevelResult> = frontier
            .par_iter()
            .map(|&id| {
                let key = &keys[id];
                let stamp = file_stamp(key);
                if let (Some(cache), Some(stamp)) = (cache_ref, stamp) {
                    if let Some((cached_stamp, processed)) = cache.entries.get(key) {
                        if *cached_stamp == stamp {
                            return (id, Some(stamp), true, Ok(Arc::clone(processed)));
                        }
                    }
                }
                (id, stamp, false, process_module(key, ctx).map(Arc::new))
            })
            .collect();
        let mut next = Vec::new();
        for (id, stamp, from_cache, result) in results {
            match result {
                Ok(processed) => {
                    if !from_cache {
                        processed_count += 1;
                        if let (Some(cache), Some(stamp)) = (cache.as_deref_mut(), stamp) {
                            cache.entries.insert(keys[id].clone(), (stamp, Arc::clone(&processed)));
                        }
                    }
                    let mut dep_ids = Vec::with_capacity(processed.deps.len());
                    for dep in &processed.deps {
                        let dep_id = match index.get(dep) {
                            Some(&existing) => existing,
                            None => {
                                let new_id = keys.len();
                                index.insert(dep.clone(), new_id);
                                keys.push(dep.clone());
                                slots.push(None);
                                next.push(new_id);
                                new_id
                            }
                        };
                        dep_ids.push(dep_id);
                    }
                    warnings.extend(processed.warnings.iter().cloned());
                    slots[id] = Some(Module { key: keys[id].clone(), processed, deps: dep_ids });
                }
                Err(e) => {
                    if let Some(cache) = cache.as_deref_mut() {
                        cache.entries.remove(&keys[id]);
                    }
                    errors.push(e)
                }
            }
        }
        frontier = next;
    }

    if !errors.is_empty() {
        return Err(errors);
    }
    if let Some(cache) = cache {
        // Forget modules that are no longer part of the app.
        cache.entries.retain(|key, _| index.contains_key(key));
    }
    let modules = slots.into_iter().map(|m| m.expect("every discovered module is processed")).collect();
    warnings.sort();
    warnings.dedup();
    Ok(Graph { modules, warnings, processed_count })
}

/// Stylesheets of the included modules, in the order the browser would apply them
/// (depth-first, dependencies first).
pub fn css_in_order(graph: &Graph, entries: &[usize], included: &[bool]) -> Vec<usize> {
    fn visit(graph: &Graph, id: usize, included: &[bool], seen: &mut [bool], out: &mut Vec<usize>) {
        if seen[id] || !included[id] {
            return;
        }
        seen[id] = true;
        for &dep in &graph.modules[id].deps {
            visit(graph, dep, included, seen, out);
        }
        if matches!(graph.modules[id].output(), ModuleOutput::Css { .. }) {
            out.push(id);
        }
    }
    let mut seen = vec![false; graph.modules.len()];
    let mut out = Vec::new();
    for &entry in entries {
        visit(graph, entry, included, &mut seen, &mut out);
    }
    out
}
