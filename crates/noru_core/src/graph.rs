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

use crate::asset::{is_asset_extension, is_image_extension, process_asset, AssetOptions};
use crate::css::process_css;
use crate::env::Defines;
use crate::js::{process_js, EsmInfo, JsContext, Segment};
use crate::module::{EmittedFile, ModuleKey};
use crate::next::NextApp;
use crate::pkg::PackageCache;
use crate::postcss::PostCss;
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
    /// Next.js App Router project: generated modules and `next/*` replacements.
    pub next: Option<NextApp>,
    /// Project with a PostCSS config (Tailwind CSS...).
    pub postcss: Option<PostCss>,
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
        let virtual_importer;
        let mut importer = importer;
        if let Some(next) = &self.next {
            if let Some((path, warning)) = next.resolve(specifier) {
                return Ok((ModuleKey::new(path, None), warning));
            }
            if next.is_virtual(importer) {
                virtual_importer = next.virtual_importer();
                importer = &virtual_importer;
            }
        }
        // `/file` that exists in public/ is served as-is: importing it gives its URL.
        if let Some(rest) = specifier.strip_prefix('/').filter(|r| !r.starts_with('/')) {
            let clean = rest.split(['?', '#']).next().unwrap_or(rest);
            let candidate = self.public_dir.join(clean);
            if candidate.is_file() {
                return Ok((ModuleKey::new(candidate, Some(PUBLIC_QUERY.to_string())), None));
            }
        }
        match self.resolver.resolve(importer, specifier, kind) {
            Ok(resolved) => {
                // Node.js built-in in a Next.js app: use the browser version shipped by Next.js.
                if let (true, Some(next), Some(polyfill)) =
                    (resolved.key.is_empty_module(), &self.next, crate::next::node_polyfill(specifier))
                {
                    if let Ok(found) = self.resolver.resolve(&next.virtual_importer(), polyfill, kind) {
                        return Ok((found.key, None));
                    }
                }
                Ok((resolved.key, resolved.warning))
            }
            Err(error) => match self.next.as_ref().and_then(|next| next.missing_module(&error, importer)) {
                Some((path, query, warning)) => Ok((ModuleKey::new(path, Some(query)), Some(warning))),
                None => Err(error),
            },
        }
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

fn process_js_module(
    key: &ModuleKey,
    source: &str,
    ctx: &Context,
    side_effects_hint: Option<bool>,
) -> Result<Processed, String> {
    let out = process_js(key, source, ctx)?;
    let module = JsModule { segments: out.segments, esm: out.esm, side_effects_hint, refresh: out.refresh };
    Ok(Processed { output: ModuleOutput::Js(module), deps: out.deps, emitted: vec![], warnings: out.warnings })
}

/// Project stylesheets that go through PostCSS (Tailwind...).
fn uses_postcss(key: &ModuleKey, ctx: &Context) -> bool {
    ctx.postcss.is_some() && key.extension() == "css" && !key.is_in_node_modules() && !key.is_empty_module()
}

/// Source of a generated (in-memory) module.
fn virtual_source<'c>(key: &ModuleKey, ctx: &'c Context) -> Option<&'c str> {
    ctx.next.as_ref().and_then(|next| next.source(&key.path))
}

fn process_module(key: &ModuleKey, ctx: &Context) -> Result<Processed, String> {
    if key.is_empty_module() {
        return Ok(Processed::simple("function() {}".to_string()));
    }
    if let Some(source) = virtual_source(key, ctx) {
        return process_js_module(key, source, ctx, None);
    }
    if let Some(source) = ctx.next.as_ref().and_then(|next| next.missing_source(&key.path, key.query.as_deref())) {
        return process_js_module(key, &source, ctx, None);
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
            process_js_module(key, &source, ctx, ctx.packages.side_effects(path))
        }
        "css" => {
            let mut source = read_text(path)?;
            let mut postcss_warnings = Vec::new();
            if let Some(postcss) = ctx.postcss.as_ref().filter(|_| !key.is_in_node_modules()) {
                (source, postcss_warnings) = postcss.process(path, &source)?;
            }
            let resolve = |specifier: &str| ctx.resolver.resolve(path, specifier, ResolveKind::Css).map(|r| r.key);
            let mut out = process_css(path, &source, ctx.minify, &assets, &resolve)?;
            out.warnings.extend(postcss_warnings);
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
            // Next.js: `import logo from "./logo.png"` gives { src, width, height } (used by next/image).
            let value = if ctx.next.is_some() && is_image_extension(&ext) {
                serde_json::json!({ "src": url, "width": null, "height": null })
            } else {
                serde_json::Value::String(url)
            };
            let mut p = Processed::simple(exports_factory(&value.to_string()));
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

fn file_stamp(key: &ModuleKey, ctx: &Context) -> Option<FileStamp> {
    if key.is_empty_module() {
        return Some(FileStamp { modified: None, len: 0 });
    }
    if let Some(source) = virtual_source(key, ctx) {
        return Some(FileStamp { modified: None, len: xxhash_rust::xxh3::xxh3_64(source.as_bytes()) });
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

    let entry_count = keys.len();
    let mut cache = cache;
    let mut errors = Vec::new();
    let mut warnings = Vec::new();
    let mut processed_count = 0;

    std::thread::scope(|scope| {
        // Stylesheets that go through PostCSS can take seconds (Tailwind scans the whole project):
        // they are processed on their own thread, the rest of the graph does not wait for them.
        let mut slow: Vec<std::thread::ScopedJoinHandle<LevelResult>> = Vec::new();
        while !frontier.is_empty() || !slow.is_empty() {
            let cache_ref = cache.as_deref();
            let cached = |id: usize| -> (Option<FileStamp>, Option<Arc<Processed>>) {
                let key = &keys[id];
                let stamp = file_stamp(key, ctx);
                if let (Some(cache), Some(stamp)) = (cache_ref, stamp) {
                    if let Some((cached_stamp, processed)) = cache.entries.get(key) {
                        if *cached_stamp == stamp {
                            return (Some(stamp), Some(Arc::clone(processed)));
                        }
                    }
                }
                (stamp, None)
            };
            let (postcss, fast): (Vec<usize>, Vec<usize>) =
                frontier.iter().partition(|&&id| uses_postcss(&keys[id], ctx));
            let mut results: Vec<LevelResult> = Vec::new();
            for id in postcss {
                match cached(id) {
                    (stamp, Some(processed)) => results.push((id, stamp, true, Ok(processed))),
                    (stamp, None) => {
                        let key = keys[id].clone();
                        slow.push(scope.spawn(move || (id, stamp, false, process_module(&key, ctx).map(Arc::new))));
                    }
                }
            }
            results.extend(
                fast.par_iter()
                    .map(|&id| match cached(id) {
                        (stamp, Some(processed)) => (id, stamp, true, Ok(processed)),
                        (stamp, None) => (id, stamp, false, process_module(&keys[id], ctx).map(Arc::new)),
                    })
                    .collect::<Vec<_>>(),
            );
            // Stylesheets that are done; when nothing else is left to do, wait for one.
            let mut i = 0;
            while i < slow.len() {
                if slow[i].is_finished() {
                    results.push(slow.swap_remove(i).join().expect("PostCSS thread panicked"));
                } else {
                    i += 1;
                }
            }
            if results.is_empty() && !slow.is_empty() {
                results.push(slow.remove(0).join().expect("PostCSS thread panicked"));
            }
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
    });

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
    Ok(Graph { modules: canonical_order(modules, entry_count), warnings, processed_count })
}

/// Renumbers the modules in breadth-first order from the entries, so that ids (and the output)
/// do not depend on which thread finished first. Without PostCSS this is the discovery order.
fn canonical_order(modules: Vec<Module>, entry_count: usize) -> Vec<Module> {
    let n = modules.len();
    let mut order: Vec<usize> = (0..entry_count.min(n)).collect();
    let mut seen = vec![false; n];
    order.iter().for_each(|&id| seen[id] = true);
    let mut i = 0;
    while i < order.len() {
        for &dep in &modules[order[i]].deps {
            if !seen[dep] {
                seen[dep] = true;
                order.push(dep);
            }
        }
        i += 1;
    }
    order.extend((0..n).filter(|&id| !seen[id]));
    if order.iter().enumerate().all(|(new, &old)| new == old) {
        return modules;
    }
    let mut new_id = vec![0; n];
    for (new, &old) in order.iter().enumerate() {
        new_id[old] = new;
    }
    let mut slots: Vec<Option<Module>> = modules.into_iter().map(Some).collect();
    order
        .iter()
        .map(|&old| {
            let mut module = slots[old].take().expect("each module is placed once");
            module.deps.iter_mut().for_each(|dep| *dep = new_id[*dep]);
            module
        })
        .collect()
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
