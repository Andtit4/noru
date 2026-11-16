//! Assembles the final JavaScript and CSS bundles from the module graph.

use std::collections::HashMap;
use std::path::Path;

use oxc::allocator::Allocator;
use oxc::codegen::{Codegen, CodegenOptions, CommentOptions, LegalComment};
use oxc::minifier::{CompressOptions, MangleOptions, Minifier, MinifierOptions};
use oxc::parser::Parser;
use oxc::span::SourceType;

use crate::graph::{css_in_order, Graph, JsModule, ModuleOutput};
use crate::js::{ExportTarget, PreambleItem};
use crate::module::member_access;
use crate::treeshake::{ModuleUsage, ShakeResult};

const RUNTIME: &str = include_str!("runtime.js");
const HMR_RUNTIME: &str = include_str!("hmr-runtime.js");
const REACT_REFRESH_RUNTIME: &str = include_str!("vendor/react-refresh-runtime.js");

/// One module of the bundle, rendered as a factory function.
#[derive(Debug, Clone)]
pub struct RenderedModule {
    /// Id of the module in the bundle.
    pub id: usize,
    /// Path relative to the project root (for comments and React Refresh ids).
    pub name: String,
    pub factory: String,
    /// Bundle ids of its dependencies (used by hot module replacement).
    pub deps: Vec<usize>,
}

/// Renders the factory functions of the included modules. `id_of` maps graph ids to bundle ids.
/// With `refresh`, modules compiled with React Refresh get their `$RefreshReg$` helpers.
pub fn render_modules(
    graph: &Graph,
    root: &Path,
    shake: &ShakeResult,
    id_of: &dyn Fn(usize) -> Option<usize>,
    refresh: bool,
) -> Vec<RenderedModule> {
    let mut modules = Vec::new();
    for (graph_id, module) in graph.modules.iter().enumerate() {
        let Some(id) = id_of(graph_id).filter(|_| shake.included[graph_id]) else { continue };
        let name = module.key.display(root).replace('\n', " ");
        let dep_id = |i: usize| module.deps.get(i).and_then(|&dep| id_of(dep).filter(|_| shake.included[dep]));
        let mut factory = String::new();
        match module.output() {
            ModuleOutput::Js(js) => {
                let prefix = (refresh && js.refresh).then(|| refresh_helpers(&name));
                render_js(&mut factory, js, &shake.usage[graph_id], &dep_id, prefix.as_deref());
            }
            ModuleOutput::Css { module_exports: Some(exports), .. } => {
                factory.push_str("function(module) { module.exports = ");
                factory.push_str(exports);
                factory.push_str("; }");
            }
            ModuleOutput::Css { module_exports: None, .. } => factory.push_str("function() {}"),
            ModuleOutput::Static(code) => factory.push_str(code),
        }
        let deps = (0..module.deps.len()).filter_map(dep_id).collect();
        modules.push(RenderedModule { id, name, factory, deps });
    }
    modules
}

/// `$RefreshReg$` / `$RefreshSig$` for a module compiled with React Refresh.
fn refresh_helpers(name: &str) -> String {
    let prefix = serde_json::to_string(&format!("{name} ")).unwrap_or_default();
    format!(
        "var $RefreshReg$ = function(type, id) {{ __noru_refresh.register(type, {prefix} + id); }}, $RefreshSig$ = __noru_refresh.createSignatureFunctionForTransform;\n"
    )
}

/// Generates the production JS bundle: a registry of the included modules, the noru runtime,
/// then a `require` of every entry.
pub fn generate_js(
    graph: &Graph,
    entries: &[usize],
    root: &Path,
    minify: bool,
    shake: &ShakeResult,
) -> Result<String, String> {
    // Only included modules get an id, numbered compactly.
    let mut new_ids = vec![None; graph.modules.len()];
    let mut next = 0;
    for (id, included) in shake.included.iter().enumerate() {
        if *included {
            new_ids[id] = Some(next);
            next += 1;
        }
    }
    let modules = render_modules(graph, root, shake, &|id| new_ids[id], false);

    let mut out = String::with_capacity(64 * 1024);
    out.push_str("var __noru_modules = [\n");
    for module in &modules {
        out.push_str(&format!("// {}\n{},\n", module.name, module.factory));
    }
    out.push_str("];\n");
    out.push_str(RUNTIME);
    for entry in entries {
        if let Some(id) = new_ids[*entry] {
            out.push_str(&format!("__noru_require({id});\n"));
        }
    }
    if minify {
        minify_js(&out)
    } else {
        Ok(out)
    }
}

/// `__noru_import` of the runtime, replaced in split builds by a version that loads chunks first.
const IMPORT_FN: &str = "function __noru_import(id) {\n  return Promise.resolve().then(function () { return __noru_toESM(__noru_require(id)); });\n}";
const SPLIT_IMPORT_FN: &str = "var __noru_loading = {};
function __noru_load(index) {
  return __noru_loading[index] || (__noru_loading[index] = import(new URL(__noru_base + __noru_chunk_files[index], document.baseURI).href).catch(function (error) {
    delete __noru_loading[index];
    throw error;
  }));
}
function __noru_import(id) {
  return Promise.all((__noru_chunk_map[id] || []).map(__noru_load)).then(function () { return __noru_toESM(__noru_require(id)); });
}";

/// Shared chunks smaller than this are merged together (fewer requests).
const SMALL_CHUNK: usize = 8 * 1024;

/// A file of a split production build (`assets/<name>-<hash>.js`).
pub struct ChunkFile {
    pub file_name: String,
    pub code: String,
}

/// Production JavaScript split into an entry file and chunks loaded on demand (`import()`).
pub struct SplitBundle {
    pub main: String,
    pub chunks: Vec<ChunkFile>,
    /// For each module of the graph: the chunk it is in (`None`: the entry file, or not included).
    pub module_chunk: Vec<Option<usize>>,
    /// For each module loaded with `import()` (graph id): the chunks to load first.
    pub root_chunks: HashMap<usize, Vec<usize>>,
    /// Size of each included module's code (graph id, bytes before minification), for the report.
    pub sizes: Vec<(usize, usize)>,
}

/// Generates the production JavaScript, split at `import()` points: modules reachable from the
/// entries with static imports form the entry file; each module loaded with `import()` gets a chunk
/// with what only it needs; modules shared by several of them go to shared chunks.
pub fn generate_split_js(
    graph: &Graph,
    entries: &[usize],
    root: &Path,
    minify: bool,
    shake: &ShakeResult,
    base: &str,
) -> Result<SplitBundle, String> {
    let n = graph.modules.len();
    let mut new_ids = vec![None; n];
    let mut next_id = 0;
    for (id, included) in shake.included.iter().enumerate() {
        if *included {
            new_ids[id] = Some(next_id);
            next_id += 1;
        }
    }
    // Static dependencies (followed when grouping modules) and import() targets.
    let static_deps = |id: usize| -> Vec<usize> {
        let module = &graph.modules[id];
        let dynamic: &[usize] = match module.output() {
            ModuleOutput::Js(js) => &js.dynamic_only,
            _ => &[],
        };
        module
            .deps
            .iter()
            .enumerate()
            .filter(|(i, d)| !dynamic.contains(i) && shake.included[**d])
            .map(|(_, d)| *d)
            .collect()
    };
    let reach = |start: usize, stop: &[bool]| -> Vec<usize> {
        let mut seen = vec![false; n];
        let mut queue = vec![start];
        seen[start] = true;
        let mut i = 0;
        while i < queue.len() {
            for dep in static_deps(queue[i]) {
                if !seen[dep] && !stop[dep] {
                    seen[dep] = true;
                    queue.push(dep);
                }
            }
            i += 1;
        }
        queue
    };

    let mut in_main = vec![false; n];
    let none = vec![false; n];
    for &entry in entries {
        for id in reach(entry, &none) {
            in_main[id] = true;
        }
    }
    let mut roots: Vec<usize> = Vec::new();
    for (id, module) in graph.modules.iter().enumerate() {
        let ModuleOutput::Js(js) = module.output() else { continue };
        if !shake.included[id] {
            continue;
        }
        for &i in &js.dynamic_only {
            if let Some(&target) = module.deps.get(i) {
                if shake.included[target] && !in_main[target] && !roots.contains(&target) {
                    roots.push(target);
                }
            }
        }
    }
    roots.sort_unstable();

    // Which roots need each module, then one chunk per distinct set of roots.
    let mut owners: Vec<Vec<usize>> = vec![Vec::new(); n];
    let mut reached: HashMap<usize, Vec<usize>> = HashMap::new();
    for &r in &roots {
        let modules = reach(r, &in_main);
        for &m in &modules {
            owners[m].push(r);
        }
        reached.insert(r, modules);
    }
    let modules = render_modules(graph, root, shake, &|id| new_ids[id], false);
    let factory_of: HashMap<usize, &RenderedModule> = modules.iter().map(|m| (m.id, m)).collect();
    let size_of = |id: usize| new_ids[id].and_then(|nid| factory_of.get(&nid)).map_or(0, |m| m.factory.len());

    let mut group_index: HashMap<Vec<usize>, usize> = HashMap::new();
    let mut groups: Vec<(Vec<usize>, Vec<usize>)> = Vec::new(); // (owners, modules)
    for id in 0..n {
        if in_main[id] || owners[id].is_empty() {
            continue;
        }
        let key = owners[id].clone();
        let index = *group_index.entry(key.clone()).or_insert_with(|| {
            groups.push((key, Vec::new()));
            groups.len() - 1
        });
        groups[index].1.push(id);
    }
    // Merge small shared groups into one chunk.
    let mut chunk_of_group = vec![0usize; groups.len()];
    let mut chunk_groups: Vec<Vec<usize>> = Vec::new();
    let mut small_shared: Option<usize> = None;
    for (g, (owners, members)) in groups.iter().enumerate() {
        let size: usize = members.iter().map(|&m| size_of(m)).sum();
        if owners.len() > 1 && size < SMALL_CHUNK {
            let chunk = *small_shared.get_or_insert_with(|| {
                chunk_groups.push(Vec::new());
                chunk_groups.len() - 1
            });
            chunk_groups[chunk].push(g);
            chunk_of_group[g] = chunk;
        } else {
            chunk_groups.push(vec![g]);
            chunk_of_group[g] = chunk_groups.len() - 1;
        }
    }
    let mut module_chunk: Vec<Option<usize>> = vec![None; n];
    for (g, (_, members)) in groups.iter().enumerate() {
        for &m in members {
            module_chunk[m] = Some(chunk_of_group[g]);
        }
    }

    // Chunk files.
    let mut chunks = Vec::new();
    for groups_in_chunk in &chunk_groups {
        let members: Vec<usize> = {
            let mut list: Vec<usize> = groups_in_chunk.iter().flat_map(|&g| groups[g].1.iter().copied()).collect();
            list.sort_unstable();
            list
        };
        let label = if groups_in_chunk.len() == 1 && groups[groups_in_chunk[0]].0.len() == 1 {
            chunk_label(&graph.modules[groups[groups_in_chunk[0]].0[0]].key.display(root))
        } else {
            "shared".to_string()
        };
        let mut code = String::from(
            "window.__noru_register(function (__noru_esm, __noru_export, __noru_reexport, __noru_toESM, __noru_import) {\nreturn {\n",
        );
        for &m in &members {
            if let Some(module) = new_ids[m].and_then(|nid| factory_of.get(&nid)) {
                code.push_str(&format!("// {}\n{}: {},\n", module.name, module.id, module.factory));
            }
        }
        code.push_str("};\n});\n");
        let code = if minify { minify_js(&code)? } else { code };
        let file_name = format!("assets/{label}-{}.js", crate::module::content_hash(code.as_bytes()));
        chunks.push(ChunkFile { file_name, code });
    }

    let mut root_chunks: HashMap<usize, Vec<usize>> = HashMap::new();
    for (&r, members) in &reached {
        let mut list: Vec<usize> = members.iter().filter_map(|&m| module_chunk[m]).collect();
        list.sort_unstable();
        list.dedup();
        root_chunks.insert(r, list);
    }

    // Entry file: its modules, the chunk manifest and the runtime.
    let mut main = String::with_capacity(64 * 1024);
    main.push_str("var __noru_modules = {\n");
    for (id, &in_entry) in in_main.iter().enumerate() {
        if let Some(module) = new_ids[id].filter(|_| in_entry).and_then(|nid| factory_of.get(&nid)) {
            main.push_str(&format!("// {}\n{}: {},\n", module.name, module.id, module.factory));
        }
    }
    main.push_str("};\n");
    let files: Vec<&str> = chunks.iter().map(|c| c.file_name.as_str()).collect();
    let map: serde_json::Map<String, serde_json::Value> =
        root_chunks.iter().filter_map(|(&r, list)| Some((new_ids[r]?.to_string(), serde_json::json!(list)))).collect();
    main.push_str(&format!("var __noru_chunk_files = {};\n", serde_json::json!(files)));
    main.push_str(&format!("var __noru_chunk_map = {};\n", serde_json::Value::Object(map)));
    main.push_str(&format!("var __noru_base = {};\n", serde_json::json!(base)));
    debug_assert!(RUNTIME.contains(IMPORT_FN), "runtime.js __noru_import changed");
    main.push_str(&RUNTIME.replace(IMPORT_FN, SPLIT_IMPORT_FN));
    main.push_str(
        "window.__noru_register = function (make) {\n  var factories = make(__noru_esm, __noru_export, __noru_reexport, __noru_toESM, __noru_import);\n  for (var id in factories) __noru_modules[id] = factories[id];\n};\n",
    );
    for &entry in entries {
        if let Some(id) = new_ids[entry] {
            main.push_str(&format!("__noru_require({id});\n"));
        }
    }
    let main = if minify { minify_js(&main)? } else { main };
    let sizes = (0..n).filter(|&id| shake.included[id]).map(|id| (id, size_of(id))).collect();
    Ok(SplitBundle { main, chunks, module_chunk, root_chunks, sizes })
}

/// `app/dashboard/[id]/page.tsx` -> `dashboard-id-page`.
fn chunk_label(path: &str) -> String {
    let path = path.trim_start_matches("./").trim_start_matches("src/").trim_start_matches("app/");
    let stem = path.rsplit_once('.').map_or(path, |(s, _)| s);
    let mut label: String =
        stem.chars().map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' }).collect();
    while label.contains("--") {
        label = label.replace("--", "-");
    }
    let label = label.trim_matches('-');
    let label = if label.len() > 40 { &label[label.len() - 40..] } else { label };
    if label.is_empty() {
        "chunk".to_string()
    } else {
        label.trim_matches('-').to_string()
    }
}

/// Generates the server bundle (Next.js middleware and route handlers) for Node.js: a CommonJS
/// script whose `module.exports` is the generated server entry. Run by server-runtime.js, which
/// provides `__noru_node_require` (the project's `require`, for npm packages).
pub fn generate_server_js(graph: &Graph, root: &Path) -> String {
    let shake = crate::treeshake::shake(graph, &[0], false);
    let modules = render_modules(graph, root, &shake, &|id| Some(id), false);
    let mut out = String::with_capacity(64 * 1024);
    out.push_str("var __noru_modules = [\n");
    for module in &modules {
        out.push_str(&format!("// {}\n{},\n", module.name, module.factory));
    }
    out.push_str("];\n");
    out.push_str(RUNTIME);
    out.push_str("module.exports = __noru_require(0);\n");
    out
}

/// Generates the development bundle: like the production one, plus the hot module replacement
/// runtime and React Fast Refresh. Module ids are stable across rebuilds (holes are allowed).
pub fn generate_dev_js(modules: &[RenderedModule], entries: &[usize]) -> String {
    let mut out = String::with_capacity(256 * 1024);
    out.push_str("var __noru_modules = {\n");
    for module in modules {
        out.push_str(&format!("// {}\n{}: {},\n", module.name, module.id, module.factory));
    }
    out.push_str("};\n");
    let deps: serde_json::Map<String, serde_json::Value> =
        modules.iter().map(|m| (m.id.to_string(), serde_json::json!(m.deps))).collect();
    out.push_str(&format!("var __noru_deps = {};\n", serde_json::Value::Object(deps)));
    out.push_str(RUNTIME);
    out.push_str(&HMR_RUNTIME.replace("__NORU_REACT_REFRESH_RUNTIME__", REACT_REFRESH_RUNTIME));
    for entry in entries {
        out.push_str(&format!("__noru_require({entry});\n"));
    }
    out
}

/// A hot update script: new factories for the changed modules, applied by the HMR runtime.
pub fn generate_hot_update(changed: &[&RenderedModule]) -> String {
    let mut factories = String::new();
    let mut deps = serde_json::Map::new();
    for module in changed {
        factories.push_str(&format!("// {}\n{}: {},\n", module.name, module.id, module.factory));
        deps.insert(module.id.to_string(), serde_json::json!(module.deps));
    }
    format!(
        "(function (__noru_esm, __noru_export, __noru_reexport, __noru_toESM, __noru_import, __noru_refresh) {{\nwindow.__noru_hmr.apply({{\n{factories}}}, {});\n}}).apply(null, window.__noru_hmr.helpers);\n",
        serde_json::Value::Object(deps)
    )
}

/// Writes the factory function of a JS module, keeping only what tree-shaking marked as used.
fn render_js(
    out: &mut String,
    js: &JsModule,
    usage: &ModuleUsage,
    dep_id: &dyn Fn(usize) -> Option<usize>,
    prefix: Option<&str>,
) {
    let Some(esm) = &js.esm else {
        out.push_str("function(module, exports, require) {\n");
        out.push_str(prefix.unwrap_or(""));
        for segment in &js.segments {
            segment.code.render(out, dep_id);
        }
        out.push_str("\n}");
        return;
    };

    out.push_str("function(__noru_module, __noru_exports, __noru_require) {\n__noru_esm(__noru_exports);\n");
    out.push_str(prefix.unwrap_or(""));

    // Live getters for the used exports.
    let getter = |target: &ExportTarget| -> Option<String> {
        match target {
            ExportTarget::Local { expr, .. } => Some(expr.clone()),
            ExportTarget::ReExport { dep, ns, imported } => {
                dep_id(*dep)?;
                Some(imported.as_ref().map_or_else(|| ns.clone(), |name| member_access(ns, name)))
            }
        }
    };
    let mut getters: Vec<(String, String)> = Vec::new();
    if usage.all_exports {
        for (name, target) in &esm.exports {
            if let Some(expr) = getter(target) {
                getters.push((name.clone(), expr));
            }
        }
    } else {
        for name in &usage.export_names {
            if let Some((_, target)) = esm.exports.iter().find(|(n, _)| n == name) {
                if let Some(expr) = getter(target) {
                    getters.push((name.clone(), expr));
                }
            } else if let Some(&k) = usage.star_names.get(name) {
                if dep_id(esm.stars[k].0).is_some() {
                    getters.push((name.clone(), member_access(&esm.stars[k].1, name)));
                }
            }
        }
    }
    if !getters.is_empty() {
        out.push_str("__noru_export(__noru_exports, {");
        for (i, (name, expr)) in getters.iter().enumerate() {
            if i > 0 {
                out.push_str(", ");
            }
            out.push_str(&serde_json::to_string(name).unwrap_or_default());
            out.push_str(": () => ");
            out.push_str(expr);
        }
        out.push_str("});\n");
    }

    // Dependencies, in source order (only those that are in the bundle).
    for item in &esm.preamble {
        match item {
            PreambleItem::Import { dep, ns } => {
                let Some(id) = dep_id(*dep) else { continue };
                match ns {
                    Some(ns) => out.push_str(&format!("var {ns} = __noru_toESM(__noru_require({id}));\n")),
                    None => out.push_str(&format!("__noru_require({id});\n")),
                }
            }
            PreambleItem::Star(k) => {
                let (dep, var) = &esm.stars[*k];
                let Some(id) = dep_id(*dep) else { continue };
                if usage.all_exports {
                    out.push_str(&format!("__noru_reexport(__noru_exports, __noru_require({id}));\n"));
                } else if usage.star_names.values().any(|v| v == k) {
                    out.push_str(&format!("var {var} = __noru_require({id});\n"));
                } else {
                    out.push_str(&format!("__noru_require({id});\n"));
                }
            }
        }
    }

    for segment in &js.segments {
        let live = segment.stmt.is_none_or(|i| usage.live_stmts.get(i).copied().unwrap_or(true));
        if live {
            segment.code.render(out, dep_id);
        }
    }
    out.push_str("\n}");
}

pub fn generate_css(graph: &Graph, entries: &[usize], minify: bool, included: &[bool]) -> String {
    let separator = if minify { "" } else { "\n" };
    // External `@import url(...)` rules (put first in each stylesheet by process_css) must come
    // before any other rule: they are moved to the top of the bundle.
    let mut external: Vec<&str> = Vec::new();
    let mut bodies: Vec<&str> = Vec::new();
    for id in css_in_order(graph, entries, included) {
        let ModuleOutput::Css { code, .. } = graph.modules[id].output() else { continue };
        let mut rest = code.as_str();
        while rest.starts_with("@import url(") {
            let end = rest.find(";\n").map_or(rest.len(), |i| i + 2);
            let rule = rest[..end].trim_end();
            if !external.contains(&rule) {
                external.push(rule);
            }
            rest = &rest[end..];
        }
        if !rest.trim().is_empty() {
            bodies.push(rest);
        }
    }
    let mut css = external.join("\n");
    if !css.is_empty() {
        css.push('\n');
    }
    css.push_str(&bodies.join(separator));
    css
}

pub fn minify_js(code: &str) -> Result<String, String> {
    let allocator = Allocator::default();
    let ret = Parser::new(&allocator, code, SourceType::mjs()).parse();
    if ret.diagnostics.has_errors() {
        let details: Vec<String> =
            ret.diagnostics.errors().take(3).map(|e| e.clone().render_with_source_code(code.to_string())).collect();
        return Err(format!("internal error: generated bundle is not valid JavaScript\n{}", details.join("\n")));
    }
    let mut program = ret.program;
    let options = MinifierOptions {
        mangle: Some(MangleOptions { top_level: Some(true), ..MangleOptions::default() }),
        mangle_properties: None,
        compress: Some(CompressOptions::smallest()),
    };
    let ret = Minifier::new(options).minify(&allocator, &mut program);
    let printed = Codegen::new()
        .with_options(CodegenOptions {
            minify: true,
            comments: CommentOptions { legal: LegalComment::Eof, ..CommentOptions::disabled() },
            ..CodegenOptions::default()
        })
        .with_scoping(ret.scoping)
        .build(&program);
    Ok(printed.code)
}
