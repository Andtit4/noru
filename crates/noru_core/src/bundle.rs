//! Assembles the final JavaScript and CSS bundles from the module graph.

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
    css_in_order(graph, entries, included)
        .into_iter()
        .filter_map(|id| match graph.modules[id].output() {
            ModuleOutput::Css { code, .. } if !code.trim().is_empty() => Some(code.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join(separator)
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
