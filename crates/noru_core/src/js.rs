//! JavaScript / TypeScript modules.
//!
//! Pipeline for one file:
//! 1. (TS/JSX/user code only) parse + transform with Oxc (strip types, compile JSX) + print back to JS.
//! 2. Parse the JS and run semantic analysis (scopes, symbols, references).
//! 3. Walk the AST and record *text edits*: imports/exports are removed (they are re-created by the
//!    linker), `require("x")` gets the dependency id, compile-time constants (`process.env.NODE_ENV`,
//!    `import.meta.env.*`) are replaced, and statically dead branches are removed.
//! 4. For tree-shaking, record for every top-level statement what it declares, what it references
//!    and whether it has side effects, plus the module's imports and exports.
//! 5. Apply the edits, one code segment per top-level statement (so the linker can drop dead ones).

use std::collections::{HashMap, HashSet};
use std::path::Path;

use oxc::allocator::Allocator;
use oxc::ast::ast::*;
use oxc::ast_visit::{walk, Visit};
use oxc::codegen::Codegen;
use oxc::diagnostics::{NamedSource, OxcDiagnostic};
use oxc::parser::Parser;
use oxc::semantic::{ScopeId, Scoping, SemanticBuilder, SymbolId};
use oxc::span::{GetSpan, SourceType, Span};
use oxc::syntax::operator::{BinaryOperator, LogicalOperator, UnaryOperator};
use oxc::syntax::scope::ScopeFlags;
use oxc::transformer::{JsxOptions, JsxRuntime, ReactRefreshOptions, TransformOptions, Transformer};

use crate::env::{Defines, StaticValue};
use crate::module::{apply_edits_in, member_access, Edit, ModuleKey, Part, Template};
use crate::resolve::ResolveKind;

/// What the JS processor needs from the outside world.
pub trait JsContext: Sync {
    fn defines(&self) -> &Defines;
    fn jsx_import_source(&self) -> &str;
    /// Compile user components with React Fast Refresh registrations (dev server).
    fn react_refresh(&self) -> bool;
    /// Resolves `specifier` imported from `importer`. `Ok((key, warning))` or `Err(message)`.
    fn resolve(
        &self,
        importer: &Path,
        specifier: &str,
        kind: ResolveKind,
    ) -> Result<(ModuleKey, Option<String>), String>;
}

/// The code of one top-level statement (or of the prelude, which is always kept).
#[derive(Debug, Clone)]
pub struct Segment {
    pub stmt: Option<usize>,
    pub code: Template,
}

/// What a top-level statement declares and uses.
#[derive(Debug, Clone, Default)]
pub struct StmtInfo {
    /// Must be kept even if nothing it declares is used.
    pub side_effects: bool,
    /// Top-level symbols declared by the statement.
    pub declares: Vec<SymbolId>,
    /// Top-level symbols (local declarations and import bindings) referenced by the statement.
    pub references: Vec<SymbolId>,
    /// `ns.member` reads of namespace imports: (namespace binding, member).
    pub ns_members: Vec<(SymbolId, String)>,
    /// Dependencies loaded with `require()` / `import()` from this statement (all their exports are used).
    pub dynamic_deps: Vec<usize>,
}

#[derive(Debug, Clone)]
pub enum ExportTarget {
    /// Defined in this module: getter expression, and the statements declaring it.
    Local { expr: String, stmts: Vec<usize> },
    /// Re-exported from a dependency (`export { a } from`, `export * as ns from`, or a re-exported import).
    /// `imported: None` means the whole namespace.
    ReExport { dep: usize, ns: String, imported: Option<String> },
}

/// An import binding: `import { imported as local } from dep` (`imported: None` = `import * as`).
#[derive(Debug, Clone)]
pub struct ImportBinding {
    pub dep: usize,
    pub imported: Option<String>,
}

/// Code inserted at the top of an ES module by the linker, in source order.
#[derive(Debug, Clone)]
pub enum PreambleItem {
    /// `var ns = __noru_toESM(__noru_require(dep))`, or a bare `__noru_require(dep)`.
    Import { dep: usize, ns: Option<String> },
    /// `export * from dep`, resolved at link time. Index into `EsmInfo::stars`.
    Star(usize),
}

#[derive(Debug, Clone, Default)]
pub struct EsmInfo {
    pub stmts: Vec<StmtInfo>,
    /// Exported names, with what they point to.
    pub exports: Vec<(String, ExportTarget)>,
    /// `export * from` dependencies: (dep, variable name used for resolved names).
    pub stars: Vec<(usize, String)>,
    pub preamble: Vec<PreambleItem>,
    pub imports: HashMap<SymbolId, ImportBinding>,
    /// The module calls `eval`: no statement can be removed.
    pub has_eval: bool,
}

pub struct JsOutput {
    pub segments: Vec<Segment>,
    /// `None` for CommonJS / scripts.
    pub esm: Option<EsmInfo>,
    pub deps: Vec<ModuleKey>,
    pub warnings: Vec<String>,
    /// Compiled with React Refresh registrations (`$RefreshReg$` / `$RefreshSig$`).
    pub refresh: bool,
}

pub fn process_js(key: &ModuleKey, source: &str, ctx: &dyn JsContext) -> Result<JsOutput, String> {
    let path = key.path.as_path();
    let ext = key.extension();
    let is_typescript_or_jsx = matches!(ext.as_str(), "ts" | "tsx" | "mts" | "cts" | "jsx");
    let needs_transform = is_typescript_or_jsx || !key.is_in_node_modules();
    let refresh = needs_transform && ctx.react_refresh() && !key.is_in_node_modules();

    let transformed;
    let (code, source_type) = if needs_transform {
        transformed = transpile(path, source, ctx.jsx_import_source(), refresh)?;
        (transformed.as_str(), SourceType::mjs())
    } else {
        let st = match ext.as_str() {
            "mjs" => SourceType::mjs(),
            "cjs" => SourceType::cjs(),
            _ => SourceType::unambiguous(),
        };
        (source, st)
    };

    let allocator = Allocator::default();
    let mut ret = Parser::new(&allocator, code, source_type).parse();
    if ret.diagnostics.has_errors() && source_type.is_unambiguous() {
        // CommonJS files may use syntax that is only valid outside modules (e.g. top-level `return`).
        ret = Parser::new(&allocator, code, SourceType::cjs()).parse();
    }
    if ret.diagnostics.has_errors() {
        return Err(render_diagnostics(path, code, ret.diagnostics.errors()));
    }
    let program = ret.program;
    let semantic = SemanticBuilder::new().build(&program).semantic;
    let scoping = semantic.scoping();

    let is_esm = program.body.iter().any(Statement::is_module_declaration) || uses_import_meta(code);
    let mut analyzer = Analyzer::new(code, path, scoping, ctx, is_esm, program.body.len());
    if let Some(hashbang) = &program.hashbang {
        analyzer.edits.push(Edit::remove(hashbang.span.start, hashbang.span.end));
    }
    for (i, stmt) in program.body.iter().enumerate() {
        analyzer.stmts[i].declares = declared_symbols(stmt);
    }
    if is_esm {
        analyzer.collect_module_declarations(&program);
    }
    for (i, stmt) in program.body.iter().enumerate() {
        analyzer.cur_stmt = Some(i);
        analyzer.visit_statement(stmt);
        let side_effects = analyzer.stmt_has_side_effects(stmt);
        analyzer.stmts[i].side_effects = side_effects;
    }
    analyzer.cur_stmt = None;

    if !analyzer.errors.is_empty() {
        return Err(analyzer.errors.join("\n"));
    }

    let spans: Vec<Span> = program.body.iter().map(GetSpan::span).collect();
    let edits = std::mem::take(&mut analyzer.edits);
    let segments = build_segments(code, &spans, edits);
    let esm = is_esm.then(|| EsmInfo {
        stmts: std::mem::take(&mut analyzer.stmts),
        exports: std::mem::take(&mut analyzer.exports),
        stars: std::mem::take(&mut analyzer.stars),
        preamble: std::mem::take(&mut analyzer.preamble),
        imports: std::mem::take(&mut analyzer.import_info),
        has_eval: analyzer.has_eval,
    });

    Ok(JsOutput { segments, esm, deps: analyzer.deps, warnings: analyzer.warnings, refresh })
}

/// Splits the code into a prelude (hashbang, directives) and one segment per top-level statement,
/// applying the edits that fall into each segment.
fn build_segments(code: &str, spans: &[Span], edits: Vec<Edit>) -> Vec<Segment> {
    // Segment boundaries: [0, s0.start) prelude, then [si.start, s(i+1).start), the last one to the end.
    let mut starts: Vec<usize> = Vec::with_capacity(spans.len() + 1);
    starts.push(0);
    starts.extend(spans.iter().map(|s| s.start as usize));
    let ends: Vec<usize> = starts.iter().skip(1).copied().chain(std::iter::once(code.len())).collect();

    let mut buckets: Vec<Vec<Edit>> = vec![Vec::new(); starts.len()];
    for edit in edits {
        let pos = edit.start as usize;
        // Zero-length insertions at a boundary belong to the segment that ends there.
        let idx = if edit.start == edit.end && pos > 0 {
            starts.partition_point(|&s| s < pos).saturating_sub(1)
        } else {
            starts.partition_point(|&s| s <= pos).saturating_sub(1)
        };
        buckets[idx].push(edit);
    }

    let mut segments = Vec::with_capacity(starts.len());
    for (i, edits) in buckets.into_iter().enumerate() {
        let (from, to) = (starts[i], ends[i].max(starts[i]));
        let mut template = Template::default();
        apply_edits_in(code, from, to, edits, &mut template);
        segments.push(Segment { stmt: i.checked_sub(1), code: template });
    }
    segments
}

/// Strips TypeScript types and compiles JSX, returning plain JavaScript.
fn transpile(path: &Path, source: &str, jsx_import_source: &str, refresh: bool) -> Result<String, String> {
    let allocator = Allocator::default();
    let source_type = match SourceType::from_path(path) {
        Ok(st) if st.is_typescript() => st.with_module(true),
        // Plain .js/.mjs/.jsx user files may contain JSX (Create React App style).
        _ => SourceType::mjs().with_jsx(true),
    };
    let ret = Parser::new(&allocator, source, source_type).parse();
    if ret.diagnostics.has_errors() {
        return Err(render_diagnostics(path, source, ret.diagnostics.errors()));
    }
    let mut program = ret.program;
    let scoping =
        SemanticBuilder::new().with_excess_capacity(2.0).with_enum_eval(true).build(&program).semantic.into_scoping();
    let options = TransformOptions {
        jsx: JsxOptions {
            runtime: JsxRuntime::Automatic,
            import_source: Some(jsx_import_source.to_string()),
            development: false,
            refresh: refresh.then(ReactRefreshOptions::default),
            ..JsxOptions::enable()
        },
        ..TransformOptions::default()
    };
    let ret = Transformer::new(&allocator, path, &options).build_with_scoping(scoping, &mut program);
    if ret.diagnostics.has_errors() {
        return Err(render_diagnostics(path, source, ret.diagnostics.errors()));
    }
    Ok(Codegen::new().build(&program).code)
}

fn render_diagnostics<'d>(path: &Path, source: &str, errors: impl Iterator<Item = &'d OxcDiagnostic>) -> String {
    let name = path.to_string_lossy().to_string();
    errors
        .take(5)
        .map(|e| e.clone().render_with_source_code(NamedSource::new(name.clone(), source.to_string())))
        .collect::<Vec<_>>()
        .join("\n")
}

fn uses_import_meta(code: &str) -> bool {
    code.contains("import.meta")
}

/// JS strings may contain lone surrogates that are not valid UTF-8; render those lossily.
fn lossy(s: oxc::str::JSStr<'_>) -> String {
    match s.as_str() {
        Some(s) => s.to_string(),
        None => s.display().to_string(),
    }
}

/// Top-level symbols declared by a statement.
fn declared_symbols(stmt: &Statement) -> Vec<SymbolId> {
    fn from_var(v: &VariableDeclaration, out: &mut Vec<SymbolId>) {
        for d in &v.declarations {
            out.extend(d.id.get_binding_identifiers().iter().filter_map(|id| id.symbol_id.get()));
        }
    }
    fn from_id(id: Option<&BindingIdentifier>, out: &mut Vec<SymbolId>) {
        out.extend(id.and_then(|id| id.symbol_id.get()));
    }
    let mut out = Vec::new();
    match stmt {
        Statement::VariableDeclaration(v) => from_var(v, &mut out),
        Statement::FunctionDeclaration(f) => from_id(f.id.as_ref(), &mut out),
        Statement::ClassDeclaration(c) => from_id(c.id.as_ref(), &mut out),
        Statement::ExportDeclaration(d) => match &d.declaration {
            Declaration::VariableDeclaration(v) => from_var(v, &mut out),
            Declaration::FunctionDeclaration(f) => from_id(f.id.as_ref(), &mut out),
            Declaration::ClassDeclaration(c) => from_id(c.id.as_ref(), &mut out),
            _ => {}
        },
        Statement::ExportDefaultDeclaration(d) => match &d.declaration {
            ExportDefaultDeclarationKind::FunctionDeclaration(f) => from_id(f.id.as_ref(), &mut out),
            ExportDefaultDeclarationKind::ClassDeclaration(c) => from_id(c.id.as_ref(), &mut out),
            _ => {}
        },
        _ => {}
    }
    out
}

/// Globals that can be read without side effects (reading an undefined global throws).
const KNOWN_GLOBALS: &[&str] = &[
    "undefined",
    "NaN",
    "Infinity",
    "globalThis",
    "Object",
    "Array",
    "String",
    "Number",
    "Boolean",
    "Symbol",
    "BigInt",
    "Math",
    "JSON",
    "Date",
    "Promise",
    "Map",
    "Set",
    "WeakMap",
    "WeakSet",
    "WeakRef",
    "RegExp",
    "Error",
    "TypeError",
    "RangeError",
    "SyntaxError",
    "Reflect",
    "Proxy",
    "Intl",
    "ArrayBuffer",
    "DataView",
    "Uint8Array",
    "Int8Array",
    "Uint16Array",
    "Int16Array",
    "Uint32Array",
    "Int32Array",
    "Float32Array",
    "Float64Array",
    "parseInt",
    "parseFloat",
    "isNaN",
    "isFinite",
    "encodeURIComponent",
    "decodeURIComponent",
    "window",
    "document",
    "navigator",
    "self",
    "console",
    "setTimeout",
    "clearTimeout",
    "setInterval",
    "clearInterval",
    "requestAnimationFrame",
    "fetch",
    "URL",
    "URLSearchParams",
    "HTMLElement",
    "Element",
    "Node",
    "Event",
    "CustomEvent",
];

struct Analyzer<'s> {
    code: &'s str,
    importer: &'s Path,
    scoping: &'s Scoping,
    root_scope: ScopeId,
    ctx: &'s dyn JsContext,
    is_esm: bool,

    deps: Vec<ModuleKey>,
    dep_index: HashMap<ModuleKey, usize>,
    edits: Vec<Edit>,
    /// Imported binding -> expression that reads it (`__noru_m0.useState`).
    import_bindings: HashMap<SymbolId, String>,
    import_info: HashMap<SymbolId, ImportBinding>,
    namespace_bindings: HashSet<SymbolId>,
    exports: Vec<(String, ExportTarget)>,
    stars: Vec<(usize, String)>,
    preamble: Vec<PreambleItem>,
    stmts: Vec<StmtInfo>,
    cur_stmt: Option<usize>,
    has_eval: bool,
    namespace_count: usize,
    errors: Vec<String>,
    warnings: Vec<String>,
}

impl<'s> Analyzer<'s> {
    fn new(
        code: &'s str,
        importer: &'s Path,
        scoping: &'s Scoping,
        ctx: &'s dyn JsContext,
        is_esm: bool,
        stmt_count: usize,
    ) -> Self {
        Self {
            code,
            importer,
            scoping,
            root_scope: scoping.root_scope_id(),
            ctx,
            is_esm,
            deps: Vec::new(),
            dep_index: HashMap::new(),
            edits: Vec::new(),
            import_bindings: HashMap::new(),
            import_info: HashMap::new(),
            namespace_bindings: HashSet::new(),
            exports: Vec::new(),
            stars: Vec::new(),
            preamble: Vec::new(),
            stmts: vec![StmtInfo::default(); stmt_count],
            cur_stmt: None,
            has_eval: false,
            namespace_count: 0,
            errors: Vec::new(),
            warnings: Vec::new(),
        }
    }

    fn add_dep(&mut self, key: ModuleKey) -> usize {
        if let Some(&i) = self.dep_index.get(&key) {
            return i;
        }
        let i = self.deps.len();
        self.deps.push(key.clone());
        self.dep_index.insert(key, i);
        i
    }

    /// Resolves a dependency. Errors are recorded when `required` is true, warnings otherwise.
    fn resolve(&mut self, specifier: &str, kind: ResolveKind, required: bool) -> Option<usize> {
        match self.ctx.resolve(self.importer, specifier, kind) {
            Ok((key, warning)) => {
                if let Some(w) = warning {
                    self.warnings.push(w);
                }
                Some(self.add_dep(key))
            }
            Err(message) => {
                let message = format!("{message}\n    imported from {}", self.importer.display());
                if required {
                    self.errors.push(message);
                } else {
                    self.warnings.push(message);
                }
                None
            }
        }
    }

    fn new_name(&mut self, prefix: &str) -> String {
        let name = format!("{prefix}{}", self.namespace_count);
        self.namespace_count += 1;
        name
    }

    fn symbol_of(&self, ident: &IdentifierReference) -> Option<SymbolId> {
        let reference_id = ident.reference_id.get()?;
        self.scoping.get_reference(reference_id).symbol_id()
    }

    fn is_global(&self, ident: &IdentifierReference) -> bool {
        match ident.reference_id.get() {
            Some(id) => self.scoping.get_reference(id).symbol_id().is_none(),
            None => false,
        }
    }

    fn import_replacement(&self, ident: &IdentifierReference) -> Option<String> {
        if self.import_bindings.is_empty() {
            return None;
        }
        self.symbol_of(ident).and_then(|s| self.import_bindings.get(&s).cloned())
    }

    /// Records that the current top-level statement uses `ident` (if it is a top-level symbol).
    fn note_reference(&mut self, ident: &IdentifierReference) {
        let (Some(cur), Some(symbol)) = (self.cur_stmt, self.symbol_of(ident)) else { return };
        if self.scoping.symbol_scope_id(symbol) == self.root_scope {
            self.stmts[cur].references.push(symbol);
        }
    }

    fn note_dynamic_dep(&mut self, dep: usize) {
        if let Some(cur) = self.cur_stmt {
            self.stmts[cur].dynamic_deps.push(dep);
        }
    }

    fn remove(&mut self, span: Span) {
        self.edits.push(Edit::remove(span.start, span.end));
    }

    /// Top-level `import` / `export` statements.
    fn collect_module_declarations(&mut self, program: &Program) {
        // Pass 1: imports and re-exports, in source order (this is the evaluation order of dependencies).
        for stmt in &program.body {
            match stmt {
                Statement::ImportDeclaration(decl) => {
                    self.remove(decl.span);
                    if decl.import_kind.is_type() {
                        continue;
                    }
                    let Some(dep) = self.resolve(&lossy(decl.source.value), ResolveKind::Import, true) else {
                        continue;
                    };
                    let specifiers: Vec<_> = decl
                        .specifiers
                        .iter()
                        .flatten()
                        .filter(
                            |s| !matches!(s, ImportDeclarationSpecifier::ImportSpecifier(s) if s.import_kind.is_type()),
                        )
                        .collect();
                    if specifiers.is_empty() {
                        self.preamble.push(PreambleItem::Import { dep, ns: None });
                        continue;
                    }
                    let ns = self.new_name("__noru_m");
                    self.preamble.push(PreambleItem::Import { dep, ns: Some(ns.clone()) });
                    for spec in specifiers {
                        let Some(symbol) = spec.local().symbol_id.get() else { continue };
                        let (replacement, imported) = match spec {
                            ImportDeclarationSpecifier::ImportSpecifier(s) => {
                                let name = s.imported.name().to_string();
                                (member_access(&ns, &name), Some(name))
                            }
                            ImportDeclarationSpecifier::ImportDefaultSpecifier(_) => {
                                (member_access(&ns, "default"), Some("default".to_string()))
                            }
                            ImportDeclarationSpecifier::ImportNamespaceSpecifier(_) => {
                                self.namespace_bindings.insert(symbol);
                                (ns.clone(), None)
                            }
                        };
                        self.import_bindings.insert(symbol, replacement);
                        self.import_info.insert(symbol, ImportBinding { dep, imported });
                    }
                }
                Statement::ExportFromDeclaration(decl) => {
                    self.remove(decl.span);
                    if decl.export_kind.is_type() {
                        continue;
                    }
                    let Some(dep) = self.resolve(&lossy(decl.source.value), ResolveKind::Import, true) else {
                        continue;
                    };
                    let ns = self.new_name("__noru_m");
                    self.preamble.push(PreambleItem::Import { dep, ns: Some(ns.clone()) });
                    for spec in &decl.specifiers {
                        if spec.export_kind.is_type() {
                            continue;
                        }
                        let target = ExportTarget::ReExport {
                            dep,
                            ns: ns.clone(),
                            imported: Some(spec.local.name().to_string()),
                        };
                        self.exports.push((spec.exported.name().to_string(), target));
                    }
                }
                Statement::ExportAllDeclaration(decl) => {
                    self.remove(decl.span);
                    if decl.export_kind.is_type() {
                        continue;
                    }
                    let Some(dep) = self.resolve(&lossy(decl.source.value), ResolveKind::Import, true) else {
                        continue;
                    };
                    match &decl.exported {
                        Some(name) => {
                            let ns = self.new_name("__noru_m");
                            self.preamble.push(PreambleItem::Import { dep, ns: Some(ns.clone()) });
                            self.exports
                                .push((name.name().to_string(), ExportTarget::ReExport { dep, ns, imported: None }));
                        }
                        None => {
                            let var = self.new_name("__noru_s");
                            self.preamble.push(PreambleItem::Star(self.stars.len()));
                            self.stars.push((dep, var));
                        }
                    }
                }
                _ => {}
            }
        }

        // Which statement declares each top-level symbol.
        let mut declared_by: HashMap<SymbolId, Vec<usize>> = HashMap::new();
        for (i, info) in self.stmts.iter().enumerate() {
            for symbol in &info.declares {
                declared_by.entry(*symbol).or_default().push(i);
            }
        }
        let local = |name: String, stmts: Vec<usize>| ExportTarget::Local { expr: name, stmts };

        // Pass 2: local exports.
        for (i, stmt) in program.body.iter().enumerate() {
            match stmt {
                Statement::ExportDeclaration(decl) => {
                    let inner = decl.declaration.span();
                    match &decl.declaration {
                        Declaration::VariableDeclaration(var) => {
                            self.edits.push(Edit::remove(decl.span.start, inner.start));
                            for declarator in &var.declarations {
                                for id in declarator.id.get_binding_identifiers() {
                                    self.exports.push((id.name.to_string(), local(id.name.to_string(), vec![i])));
                                }
                            }
                        }
                        Declaration::FunctionDeclaration(f) => {
                            self.edits.push(Edit::remove(decl.span.start, inner.start));
                            if let Some(id) = &f.id {
                                self.exports.push((id.name.to_string(), local(id.name.to_string(), vec![i])));
                            }
                        }
                        Declaration::ClassDeclaration(c) => {
                            self.edits.push(Edit::remove(decl.span.start, inner.start));
                            if let Some(id) = &c.id {
                                self.exports.push((id.name.to_string(), local(id.name.to_string(), vec![i])));
                            }
                        }
                        // Type-only declarations left over: drop them.
                        _ => self.remove(decl.span),
                    }
                }
                Statement::ExportDefaultDeclaration(decl) => match &decl.declaration {
                    ExportDefaultDeclarationKind::FunctionDeclaration(f) => {
                        self.export_default_declaration(i, decl.span, f.span, f.id.as_ref());
                    }
                    ExportDefaultDeclarationKind::ClassDeclaration(c) => {
                        self.export_default_declaration(i, decl.span, c.span, c.id.as_ref());
                    }
                    ExportDefaultDeclarationKind::TSInterfaceDeclaration(_) => self.remove(decl.span),
                    other => {
                        if let Some(expr) = other.as_expression() {
                            self.edits.push(Edit::replace(decl.span.start, expr.span().start, "var __noru_default = "));
                            self.exports.push(("default".into(), local("__noru_default".into(), vec![i])));
                        }
                    }
                },
                Statement::ExportNamedDeclaration(decl) => {
                    self.remove(decl.span);
                    if decl.export_kind.is_type() {
                        continue;
                    }
                    for spec in &decl.specifiers {
                        if spec.export_kind.is_type() {
                            continue;
                        }
                        let exported = spec.exported.name().to_string();
                        let target = match &spec.local {
                            ModuleExportName::IdentifierReference(ident) => {
                                let symbol = self.symbol_of(ident);
                                match symbol.and_then(|s| self.import_info.get(&s).map(|b| (s, b.clone()))) {
                                    // Re-exporting an imported binding.
                                    Some((s, binding)) => {
                                        let replacement = self.import_bindings.get(&s).cloned().unwrap_or_default();
                                        let ns = match &binding.imported {
                                            None => replacement,
                                            Some(_) => replacement.split(['.', '[']).next().unwrap_or("").to_string(),
                                        };
                                        ExportTarget::ReExport { dep: binding.dep, ns, imported: binding.imported }
                                    }
                                    None => {
                                        let stmts =
                                            symbol.and_then(|s| declared_by.get(&s).cloned()).unwrap_or_default();
                                        local(ident.name.to_string(), stmts)
                                    }
                                }
                            }
                            other => local(other.name().to_string(), vec![]),
                        };
                        self.exports.push((exported, target));
                    }
                }
                Statement::TSExportAssignment(decl) => self.remove(decl.span),
                Statement::TSNamespaceExportDeclaration(decl) => self.remove(decl.span),
                _ => {}
            }
        }
    }

    fn export_default_declaration(&mut self, index: usize, stmt: Span, inner: Span, id: Option<&BindingIdentifier>) {
        match id {
            Some(id) => {
                // Keep the (hoisted) declaration, just drop `export default`.
                self.edits.push(Edit::remove(stmt.start, inner.start));
                self.exports
                    .push(("default".into(), ExportTarget::Local { expr: id.name.to_string(), stmts: vec![index] }));
            }
            None => {
                self.edits.push(Edit::replace(stmt.start, inner.start, "var __noru_default = "));
                self.edits.push(Edit::replace(stmt.end, stmt.end, ";"));
                self.exports.push((
                    "default".into(),
                    ExportTarget::Local { expr: "__noru_default".into(), stmts: vec![index] },
                ));
            }
        }
    }

    // ---- side effects -------------------------------------------------------------------------

    fn stmt_has_side_effects(&self, stmt: &Statement) -> bool {
        match stmt {
            Statement::ImportDeclaration(_)
            | Statement::ExportNamedDeclaration(_)
            | Statement::ExportFromDeclaration(_)
            | Statement::ExportAllDeclaration(_)
            | Statement::TSExportAssignment(_)
            | Statement::TSNamespaceExportDeclaration(_)
            | Statement::TSTypeAliasDeclaration(_)
            | Statement::TSInterfaceDeclaration(_)
            | Statement::EmptyStatement(_)
            | Statement::FunctionDeclaration(_) => false,
            Statement::ClassDeclaration(c) => !self.is_pure_class(c),
            Statement::VariableDeclaration(v) => !self.is_pure_var_declaration(v),
            Statement::ExportDeclaration(d) => match &d.declaration {
                Declaration::VariableDeclaration(v) => !self.is_pure_var_declaration(v),
                Declaration::ClassDeclaration(c) => !self.is_pure_class(c),
                Declaration::FunctionDeclaration(_) => false,
                _ => false,
            },
            Statement::ExportDefaultDeclaration(d) => match &d.declaration {
                ExportDefaultDeclarationKind::FunctionDeclaration(_)
                | ExportDefaultDeclarationKind::TSInterfaceDeclaration(_) => false,
                ExportDefaultDeclarationKind::ClassDeclaration(c) => !self.is_pure_class(c),
                other => other.as_expression().is_none_or(|e| !self.is_pure(e)),
            },
            _ => true,
        }
    }

    fn is_pure_var_declaration(&self, v: &VariableDeclaration) -> bool {
        matches!(v.kind, VariableDeclarationKind::Var | VariableDeclarationKind::Let | VariableDeclarationKind::Const)
            && v.declarations.iter().all(|d| {
                matches!(d.id, BindingPattern::BindingIdentifier(_)) && d.init.as_ref().is_none_or(|e| self.is_pure(e))
            })
    }

    fn is_pure_key(&self, key: &PropertyKey) -> bool {
        key.as_expression().is_none_or(|e| self.is_pure(e))
    }

    fn is_pure_class(&self, class: &Class) -> bool {
        if !class.decorators.is_empty() {
            return false;
        }
        if let Some(heritage) = &class.heritage {
            if !self.is_pure(&heritage.expression) {
                return false;
            }
        }
        class.body.body.iter().all(|element| match element {
            ClassElement::StaticBlock(_) => false,
            ClassElement::MethodDefinition(m) => m.decorators.is_empty() && (!m.computed || self.is_pure_key(&m.key)),
            ClassElement::PropertyDefinition(p) => {
                p.decorators.is_empty()
                    && (!p.computed || self.is_pure_key(&p.key))
                    && (!p.r#static || p.value.as_ref().is_none_or(|v| self.is_pure(v)))
            }
            ClassElement::AccessorProperty(a) => {
                a.decorators.is_empty()
                    && (!a.computed || self.is_pure_key(&a.key))
                    && (!a.r#static || a.value.as_ref().is_none_or(|v| self.is_pure(v)))
            }
            _ => true,
        })
    }

    fn is_pure_argument(&self, arg: &Argument) -> bool {
        arg.as_expression().is_some_and(|e| self.is_pure(e))
    }

    /// Whether evaluating `expr` can have no observable side effect.
    fn is_pure(&self, expr: &Expression) -> bool {
        match expr {
            Expression::BooleanLiteral(_)
            | Expression::NullLiteral(_)
            | Expression::NumericLiteral(_)
            | Expression::BigIntLiteral(_)
            | Expression::StringLiteral(_)
            | Expression::RegExpLiteral(_)
            | Expression::FunctionExpression(_)
            | Expression::ArrowFunctionExpression(_)
            | Expression::ImportMeta(_)
            | Expression::ThisExpression(_) => true,
            Expression::TemplateLiteral(t) => t.expressions.iter().all(|e| self.is_pure(e)),
            Expression::Identifier(ident) => {
                self.symbol_of(ident).is_some() || KNOWN_GLOBALS.contains(&ident.name.as_str())
            }
            Expression::ClassExpression(c) => self.is_pure_class(c),
            Expression::ObjectExpression(o) => o.properties.iter().all(|p| match p {
                ObjectPropertyKind::ObjectProperty(p) => {
                    (!p.computed || self.is_pure_key(&p.key)) && self.is_pure(&p.value)
                }
                ObjectPropertyKind::SpreadProperty(_) => false,
            }),
            Expression::ArrayExpression(a) => a.elements.iter().all(|el| match el {
                ArrayExpressionElement::SpreadElement(_) => false,
                ArrayExpressionElement::Elision(_) => true,
                other => other.as_expression().is_some_and(|e| self.is_pure(e)),
            }),
            Expression::UnaryExpression(u) => match u.operator {
                UnaryOperator::Delete => false,
                // `typeof undeclared` does not throw.
                UnaryOperator::Typeof if matches!(u.argument, Expression::Identifier(_)) => true,
                _ => self.is_pure(&u.argument),
            },
            Expression::BinaryExpression(b) => self.is_pure(&b.left) && self.is_pure(&b.right),
            Expression::LogicalExpression(l) => self.is_pure(&l.left) && self.is_pure(&l.right),
            Expression::ConditionalExpression(c) => {
                self.is_pure(&c.test) && self.is_pure(&c.consequent) && self.is_pure(&c.alternate)
            }
            Expression::ParenthesizedExpression(p) => self.is_pure(&p.expression),
            Expression::SequenceExpression(s) => s.expressions.iter().all(|e| self.is_pure(e)),
            // Property reads are assumed not to trigger side effects (like Rollup's default).
            Expression::StaticMemberExpression(m) => self.is_pure(&m.object),
            Expression::ComputedMemberExpression(m) => self.is_pure(&m.object) && self.is_pure(&m.expression),
            Expression::CallExpression(c) => {
                (c.pure || self.is_known_pure_call(&c.callee)) && c.arguments.iter().all(|a| self.is_pure_argument(a))
            }
            Expression::NewExpression(n) => {
                let known = matches!(&n.callee, Expression::Identifier(id)
                    if self.is_global(id) && matches!(id.name.as_str(), "Map" | "Set" | "WeakMap" | "WeakSet" | "Error"));
                (n.pure || known) && n.arguments.iter().all(|a| self.is_pure_argument(a))
            }
            _ => false,
        }
    }

    fn is_known_pure_call(&self, callee: &Expression) -> bool {
        match callee {
            Expression::Identifier(id) => self.is_global(id) && id.name == "Symbol",
            Expression::StaticMemberExpression(m) => matches!(&m.object, Expression::Identifier(obj)
                if self.is_global(obj)
                    && ((obj.name == "Symbol" && m.property.name == "for")
                        || (obj.name == "Object" && m.property.name == "freeze"))),
            _ => false,
        }
    }

    // ---- compile-time constants ---------------------------------------------------------------

    /// `process.env.NODE_ENV` -> `"process.env.NODE_ENV"`, `import.meta.env.MODE` -> ...
    fn member_chain(&self, expr: &Expression, out: &mut Vec<String>) -> bool {
        match expr {
            Expression::StaticMemberExpression(m) => {
                if m.optional || !self.member_chain(&m.object, out) {
                    return false;
                }
                out.push(m.property.name.to_string());
                true
            }
            Expression::ComputedMemberExpression(m) => {
                let Expression::StringLiteral(prop) = &m.expression else { return false };
                if m.optional || !self.member_chain(&m.object, out) {
                    return false;
                }
                out.push(lossy(prop.value));
                true
            }
            Expression::Identifier(ident) => {
                if !self.is_global(ident) {
                    return false;
                }
                out.push(ident.name.to_string());
                true
            }
            Expression::ImportMeta(_) => {
                out.push("import.meta".to_string());
                true
            }
            _ => false,
        }
    }

    /// A global variable replaced at compile time (e.g. `__dirname` or `global` in Next.js apps).
    fn identifier_define(&self, ident: &IdentifierReference) -> Option<&'s crate::env::Define> {
        if !self.is_global(ident) {
            return None;
        }
        self.ctx.defines().get(ident.name.as_str())
    }

    fn define_for(&self, expr: &Expression) -> Option<&'s crate::env::Define> {
        if !matches!(expr, Expression::StaticMemberExpression(_) | Expression::ComputedMemberExpression(_)) {
            return None;
        }
        let mut parts = Vec::new();
        if !self.member_chain(expr, &mut parts) {
            return None;
        }
        self.ctx.defines().get(&parts.join("."))
    }

    /// Evaluates an expression made only of literals and compile-time constants.
    fn static_value(&self, expr: &Expression) -> Option<StaticValue> {
        match expr {
            Expression::ParenthesizedExpression(p) => self.static_value(&p.expression),
            Expression::StringLiteral(s) => Some(StaticValue::Str(lossy(s.value))),
            Expression::NumericLiteral(n) => Some(StaticValue::Num(n.value)),
            Expression::BooleanLiteral(b) => Some(StaticValue::Bool(b.value)),
            Expression::NullLiteral(_) => Some(StaticValue::Null),
            Expression::Identifier(ident) if ident.name == "undefined" && self.is_global(ident) => {
                Some(StaticValue::Undefined)
            }
            Expression::UnaryExpression(u) => match u.operator {
                UnaryOperator::LogicalNot => Some(StaticValue::Bool(!self.static_value(&u.argument)?.truthy())),
                UnaryOperator::Void => self.static_value(&u.argument).map(|_| StaticValue::Undefined),
                _ => None,
            },
            Expression::BinaryExpression(b) => {
                let left = self.static_value(&b.left)?;
                let right = self.static_value(&b.right)?;
                match b.operator {
                    BinaryOperator::StrictEquality => Some(StaticValue::Bool(left.strict_eq(&right))),
                    BinaryOperator::StrictInequality => Some(StaticValue::Bool(!left.strict_eq(&right))),
                    BinaryOperator::Equality => left.loose_eq(&right).map(StaticValue::Bool),
                    BinaryOperator::Inequality => left.loose_eq(&right).map(|eq| StaticValue::Bool(!eq)),
                    _ => None,
                }
            }
            Expression::LogicalExpression(l) => {
                let left = self.static_value(&l.left)?;
                match l.operator {
                    LogicalOperator::And if !left.truthy() => Some(left),
                    LogicalOperator::Or if left.truthy() => Some(left),
                    LogicalOperator::Coalesce if !matches!(left, StaticValue::Null | StaticValue::Undefined) => {
                        Some(left)
                    }
                    _ => self.static_value(&l.right),
                }
            }
            Expression::StaticMemberExpression(_) | Expression::ComputedMemberExpression(_) => {
                self.define_for(expr).and_then(|d| d.value.clone())
            }
            _ => None,
        }
    }

    fn string_argument(&self, args: &[Argument]) -> Option<String> {
        if args.len() != 1 {
            return None;
        }
        match &args[0] {
            Argument::StringLiteral(s) => Some(lossy(s.value)),
            Argument::TemplateLiteral(t) if t.expressions.is_empty() && t.quasis.len() == 1 => {
                t.quasis[0].value.cooked.map(lossy)
            }
            _ => None,
        }
    }

    fn text(&self, span: Span) -> &'s str {
        &self.code[span.start as usize..span.end as usize]
    }
}

/// Collects `var` names declared in a statement (hoisted out of removed dead branches).
#[derive(Default)]
struct VarCollector {
    names: Vec<String>,
}

impl<'a> Visit<'a> for VarCollector {
    fn visit_function(&mut self, _it: &Function<'a>, _flags: ScopeFlags) {}
    fn visit_arrow_function_expression(&mut self, _it: &ArrowFunctionExpression<'a>) {}
    fn visit_class(&mut self, _it: &Class<'a>) {}
    fn visit_variable_declaration(&mut self, it: &VariableDeclaration<'a>) {
        if it.kind == VariableDeclarationKind::Var {
            for declarator in &it.declarations {
                for id in declarator.id.get_binding_identifiers() {
                    self.names.push(id.name.to_string());
                }
            }
        }
        walk::walk_variable_declaration(self, it);
    }
}

fn hoisted_vars(stmt: Option<&Statement>) -> String {
    let Some(stmt) = stmt else { return String::new() };
    let mut collector = VarCollector::default();
    collector.visit_statement(stmt);
    if collector.names.is_empty() {
        String::new()
    } else {
        collector.names.dedup();
        format!("var {};", collector.names.join(", "))
    }
}

impl<'a> Visit<'a> for Analyzer<'_> {
    fn visit_statement(&mut self, stmt: &Statement<'a>) {
        match stmt {
            Statement::ImportDeclaration(_)
            | Statement::ExportNamedDeclaration(_)
            | Statement::ExportFromDeclaration(_)
            | Statement::ExportAllDeclaration(_)
            | Statement::TSExportAssignment(_)
            | Statement::TSNamespaceExportDeclaration(_) => {}
            Statement::ExportDeclaration(decl) => self.visit_declaration(&decl.declaration),
            Statement::ExportDefaultDeclaration(decl) => match &decl.declaration {
                ExportDefaultDeclarationKind::FunctionDeclaration(f) => self.visit_function(f, ScopeFlags::Function),
                ExportDefaultDeclarationKind::ClassDeclaration(c) => self.visit_class(c),
                ExportDefaultDeclarationKind::TSInterfaceDeclaration(_) => {}
                other => {
                    if let Some(expr) = other.as_expression() {
                        self.visit_expression(expr);
                    }
                }
            },
            _ => walk::walk_statement(self, stmt),
        }
    }

    fn visit_if_statement(&mut self, it: &IfStatement<'a>) {
        let Some(test) = self.static_value(&it.test) else {
            walk::walk_if_statement(self, it);
            return;
        };
        let (kept, dead) = if test.truthy() {
            (Some(&it.consequent), it.alternate.as_ref())
        } else {
            (it.alternate.as_ref(), Some(&it.consequent))
        };
        let vars = hoisted_vars(dead);
        match kept {
            Some(kept) => {
                let ks = kept.span();
                if vars.is_empty() {
                    self.edits.push(Edit::remove(it.span.start, ks.start));
                    self.edits.push(Edit::remove(ks.end, it.span.end));
                } else {
                    self.edits.push(Edit::replace(it.span.start, ks.start, "{"));
                    self.edits.push(Edit::replace(ks.end, it.span.end, format!("\n{vars}}}")));
                }
                self.visit_statement(kept);
            }
            None => {
                let replacement = if vars.is_empty() { "{}".to_string() } else { vars };
                self.edits.push(Edit::replace(it.span.start, it.span.end, replacement));
            }
        }
    }

    fn visit_conditional_expression(&mut self, it: &ConditionalExpression<'a>) {
        let Some(test) = self.static_value(&it.test) else {
            walk::walk_conditional_expression(self, it);
            return;
        };
        let kept = if test.truthy() { &it.consequent } else { &it.alternate };
        let ks = kept.span();
        self.edits.push(Edit::replace(it.span.start, ks.start, "("));
        self.edits.push(Edit::replace(ks.end, it.span.end, ")"));
        self.visit_expression(kept);
    }

    fn visit_expression(&mut self, expr: &Expression<'a>) {
        if let Some(define) = self.define_for(expr) {
            let span = expr.span();
            self.edits.push(Edit::replace(span.start, span.end, define.code.clone()));
            return;
        }
        walk::walk_expression(self, expr);
    }

    fn visit_static_member_expression(&mut self, it: &StaticMemberExpression<'a>) {
        // `ns.member` on `import * as ns`: only `member` is used.
        if let Expression::Identifier(object) = &it.object {
            if let Some(symbol) = self.symbol_of(object).filter(|s| self.namespace_bindings.contains(s)) {
                if let Some(cur) = self.cur_stmt {
                    self.stmts[cur].ns_members.push((symbol, it.property.name.to_string()));
                }
                if let Some(replacement) = self.import_bindings.get(&symbol).cloned() {
                    self.edits.push(Edit::replace(object.span.start, object.span.end, replacement));
                }
                return;
            }
        }
        walk::walk_static_member_expression(self, it);
    }

    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if let Expression::Identifier(callee) = &it.callee {
            if callee.name == "eval" && self.is_global(callee) {
                self.has_eval = true;
            }
            // `require("x")`
            if callee.name == "require" && self.is_global(callee) {
                if let Some(specifier) = self.string_argument(&it.arguments) {
                    if let Some(dep) = self.resolve(&specifier, ResolveKind::Require, false) {
                        self.note_dynamic_dep(dep);
                        let callee_name = if self.is_esm { "__noru_require(" } else { "require(" };
                        self.edits.push(Edit::with_parts(
                            it.span.start,
                            it.span.end,
                            vec![Part::Text(callee_name.into()), Part::Dep(dep), Part::Text(")".into())],
                        ));
                    }
                    return;
                }
            }
            // Calling an imported function must not bind `this` to the namespace: `(0, ns.fn)()`.
            if let Some(replacement) = self.import_replacement(callee) {
                self.note_reference(callee);
                self.edits.push(Edit::replace(callee.span.start, callee.span.end, format!("(0, {replacement})")));
                for arg in &it.arguments {
                    self.visit_argument(arg);
                }
                return;
            }
        }
        walk::walk_call_expression(self, it);
    }

    fn visit_tagged_template_expression(&mut self, it: &TaggedTemplateExpression<'a>) {
        if let Expression::Identifier(tag) = &it.tag {
            if let Some(replacement) = self.import_replacement(tag) {
                self.note_reference(tag);
                self.edits.push(Edit::replace(tag.span.start, tag.span.end, format!("(0, {replacement})")));
                self.visit_template_literal(&it.quasi);
                return;
            }
        }
        walk::walk_tagged_template_expression(self, it);
    }

    fn visit_import_expression(&mut self, it: &ImportExpression<'a>) {
        let specifier = match &it.source {
            Expression::StringLiteral(s) => Some(lossy(s.value)),
            Expression::TemplateLiteral(t) if t.expressions.is_empty() && t.quasis.len() == 1 => {
                t.quasis[0].value.cooked.map(lossy)
            }
            _ => None,
        };
        if let Some(specifier) = specifier {
            if let Some(dep) = self.resolve(&specifier, ResolveKind::Import, false) {
                self.note_dynamic_dep(dep);
                self.edits.push(Edit::with_parts(
                    it.span.start,
                    it.span.end,
                    vec![Part::Text("__noru_import(".into()), Part::Dep(dep), Part::Text(")".into())],
                ));
            }
            return;
        }
        let text = self.text(it.span);
        self.warnings.push(format!(
            "dynamic import with a non-literal path is left as-is: {text}\n    in {}",
            self.importer.display()
        ));
        walk::walk_import_expression(self, it);
    }

    fn visit_object_property(&mut self, it: &ObjectProperty<'a>) {
        if it.shorthand {
            if let Expression::Identifier(ident) = &it.value {
                if let Some(define) = self.identifier_define(ident) {
                    let text = format!("{}: {}", ident.name, define.code);
                    self.edits.push(Edit::replace(it.span.start, it.span.end, text));
                    return;
                }
                if let Some(replacement) = self.import_replacement(ident) {
                    self.note_reference(ident);
                    let text = format!("{}: {replacement}", ident.name);
                    self.edits.push(Edit::replace(it.span.start, it.span.end, text));
                    return;
                }
            }
        }
        walk::walk_object_property(self, it);
    }

    fn visit_identifier_reference(&mut self, it: &IdentifierReference<'a>) {
        if let Some(define) = self.identifier_define(it) {
            self.edits.push(Edit::replace(it.span.start, it.span.end, define.code.clone()));
            return;
        }
        self.note_reference(it);
        if let Some(replacement) = self.import_replacement(it) {
            self.edits.push(Edit::replace(it.span.start, it.span.end, replacement));
        }
    }
}
