//! Tree-shaking: decides which modules, exports and top-level statements end up in the bundle.
//!
//! Usage requests propagate through the graph, starting from the entries:
//! - a module is *requested* with a set of export names, with "all exports" (`require()`,
//!   `import()`, dynamic namespace use), or just to be evaluated (`import './x'`);
//! - an ES module is included if it has side effects, or if one of the requested exports exists.
//!   Side effects come from the package's `"sideEffects"` field when present, otherwise from a
//!   conservative analysis of its top-level statements;
//! - inside an included ES module, the live statements are those with side effects, those that
//!   define used exports, and everything they reference (transitively). Import bindings referenced
//!   by live statements request the matching export from their dependency;
//! - `export *` is resolved statically: a requested name is looked up in the star-exported modules,
//!   so a "barrel" file only pulls the modules that are actually used;
//! - CommonJS modules cannot be analyzed: when included, everything they require is fully used.
//!
//! Requests only ever grow, so the worklist algorithm terminates.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet, VecDeque};

use oxc::semantic::SymbolId;

use crate::graph::{Graph, JsModule, ModuleOutput};
use crate::js::{EsmInfo, ExportTarget, PreambleItem};

#[derive(Debug, Default, Clone)]
pub struct ModuleUsage {
    /// Every export is used (the module is required or imported dynamically).
    pub all_exports: bool,
    /// Requested export names (only those the module actually provides get a getter).
    pub export_names: BTreeSet<String>,
    /// ES modules: which top-level statements are kept.
    pub live_stmts: Vec<bool>,
    /// Names resolved through `export *`: name -> index into `EsmInfo::stars`.
    pub star_names: BTreeMap<String, usize>,
}

pub struct ShakeResult {
    pub included: Vec<bool>,
    pub usage: Vec<ModuleUsage>,
}

impl ShakeResult {
    pub fn removed_count(&self) -> usize {
        self.included.iter().filter(|included| !**included).count()
    }
}

enum Req {
    /// Execute the module (static import), no export needed.
    Evaluate,
    Name(String),
    All,
}

fn esm_of(graph: &Graph, id: usize) -> Option<&EsmInfo> {
    match graph.modules[id].output() {
        ModuleOutput::Js(JsModule { esm: Some(esm), .. }) => Some(esm),
        _ => None,
    }
}

pub fn shake(graph: &Graph, entries: &[usize], enabled: bool) -> ShakeResult {
    let n = graph.modules.len();
    if !enabled {
        let usage = (0..n)
            .map(|id| ModuleUsage {
                all_exports: true,
                live_stmts: esm_of(graph, id).map(|esm| vec![true; esm.stmts.len()]).unwrap_or_default(),
                ..ModuleUsage::default()
            })
            .collect();
        return ShakeResult { included: vec![true; n], usage };
    }

    let mut shaker = Shaker {
        graph,
        requested: vec![false; n],
        all: vec![false; n],
        names: vec![BTreeSet::new(); n],
        forced: vec![false; n],
        queued: vec![false; n],
        queue: VecDeque::new(),
        included: vec![false; n],
        usage: vec![ModuleUsage::default(); n],
    };
    for &entry in entries {
        shaker.forced[entry] = true;
        shaker.request(entry, Req::Evaluate);
    }
    while let Some(id) = shaker.queue.pop_front() {
        shaker.queued[id] = false;
        shaker.process(id);
    }
    ShakeResult { included: shaker.included, usage: shaker.usage }
}

struct Shaker<'g> {
    graph: &'g Graph,
    requested: Vec<bool>,
    all: Vec<bool>,
    names: Vec<BTreeSet<String>>,
    /// Entries are always included.
    forced: Vec<bool>,
    queued: Vec<bool>,
    queue: VecDeque<usize>,
    included: Vec<bool>,
    usage: Vec<ModuleUsage>,
}

fn mark(i: usize, live: &mut [bool], stack: &mut Vec<usize>) {
    if i < live.len() && !live[i] {
        live[i] = true;
        stack.push(i);
    }
}

impl Shaker<'_> {
    fn request(&mut self, id: usize, req: Req) {
        let mut changed = !self.requested[id];
        self.requested[id] = true;
        match req {
            Req::Evaluate => {}
            Req::Name(name) => {
                if !self.all[id] && self.names[id].insert(name) {
                    changed = true;
                }
            }
            Req::All => {
                if !self.all[id] {
                    self.all[id] = true;
                    changed = true;
                }
            }
        }
        if changed && !self.queued[id] {
            self.queued[id] = true;
            self.queue.push_back(id);
        }
    }

    /// Whether module `id` exports `name` (directly or through `export *`).
    /// Modules that cannot be analyzed (CommonJS, JSON...) are assumed to export anything.
    fn provides(&self, id: usize, name: &str) -> bool {
        fn inner(graph: &Graph, id: usize, name: &str, visiting: &mut HashSet<usize>) -> bool {
            if !visiting.insert(id) {
                return false;
            }
            match esm_of(graph, id) {
                None => true,
                Some(esm) => {
                    esm.exports.iter().any(|(n, _)| n == name)
                        || (name != "default"
                            && esm
                                .stars
                                .iter()
                                .any(|(dep, _)| inner(graph, graph.modules[id].deps[*dep], name, visiting)))
                }
            }
        }
        inner(self.graph, id, name, &mut HashSet::new())
    }

    fn process(&mut self, id: usize) {
        let graph = self.graph;
        let module = &graph.modules[id];
        match module.output() {
            ModuleOutput::Js(js) => match &js.esm {
                Some(esm) => self.process_esm(id, esm, js.side_effects_hint),
                None => {
                    // CommonJS: whatever it requires is fully used.
                    let side_effects = js.side_effects_hint.unwrap_or(true);
                    if self.forced[id] || side_effects || self.all[id] || !self.names[id].is_empty() {
                        self.included[id] = true;
                        for &dep in &module.deps {
                            self.request(dep, Req::All);
                        }
                    }
                }
            },
            // Stylesheets always apply when imported.
            ModuleOutput::Css { .. } => {
                self.included[id] = true;
                for &dep in &module.deps {
                    self.request(dep, Req::Evaluate);
                }
            }
            // Assets, JSON, raw text: only needed if their value is used.
            ModuleOutput::Static(_) => {
                if self.forced[id] || self.all[id] || !self.names[id].is_empty() {
                    self.included[id] = true;
                }
            }
        }
    }

    fn process_esm(&mut self, id: usize, esm: &EsmInfo, side_effects_hint: Option<bool>) {
        let graph = self.graph;
        let deps = &graph.modules[id].deps;
        let has_side_effects = match side_effects_hint {
            Some(flag) => flag,
            None => esm.has_eval || esm.stmts.iter().any(|s| s.side_effects),
        };
        let wants_export = self.all[id] || self.names[id].iter().any(|name| self.provides(id, name));
        if !(self.forced[id] || has_side_effects || wants_export) {
            return;
        }
        self.included[id] = true;

        let mut live = vec![false; esm.stmts.len()];
        let mut stack = Vec::new();
        for (i, stmt) in esm.stmts.iter().enumerate() {
            if stmt.side_effects || esm.has_eval {
                mark(i, &mut live, &mut stack);
            }
        }

        // Requested exports.
        let all = self.all[id];
        let names: Vec<String> = if all {
            esm.exports.iter().map(|(name, _)| name.clone()).collect()
        } else {
            self.names[id].iter().cloned().collect()
        };
        let mut star_names = BTreeMap::new();
        for name in &names {
            match esm.exports.iter().find(|(n, _)| n == name) {
                Some((_, ExportTarget::Local { stmts, .. })) => {
                    for &i in stmts {
                        mark(i, &mut live, &mut stack);
                    }
                }
                Some((_, ExportTarget::ReExport { dep, imported, .. })) => {
                    let req = imported.clone().map_or(Req::All, Req::Name);
                    self.request(deps[*dep], req);
                }
                None if name != "default" && !all => {
                    // Resolve through `export *` (first module that provides it wins).
                    for (k, (dep, _)) in esm.stars.iter().enumerate() {
                        if self.provides(deps[*dep], name) {
                            self.request(deps[*dep], Req::Name(name.clone()));
                            star_names.insert(name.clone(), k);
                            break;
                        }
                    }
                }
                None => {}
            }
        }
        if all {
            for (dep, _) in &esm.stars {
                self.request(deps[*dep], Req::All);
            }
        }

        // Everything live statements reference is live too.
        let mut declared_by: HashMap<SymbolId, Vec<usize>> = HashMap::new();
        for (i, stmt) in esm.stmts.iter().enumerate() {
            for symbol in &stmt.declares {
                declared_by.entry(*symbol).or_default().push(i);
            }
        }
        while let Some(i) = stack.pop() {
            let stmt = &esm.stmts[i];
            for symbol in &stmt.references {
                if let Some(binding) = esm.imports.get(symbol) {
                    let req = binding.imported.clone().map_or(Req::All, Req::Name);
                    self.request(deps[binding.dep], req);
                } else if let Some(stmts) = declared_by.get(symbol) {
                    for &j in stmts {
                        mark(j, &mut live, &mut stack);
                    }
                }
            }
            for (symbol, member) in &stmt.ns_members {
                if let Some(binding) = esm.imports.get(symbol) {
                    self.request(deps[binding.dep], Req::Name(member.clone()));
                }
            }
            for &dep in &stmt.dynamic_deps {
                self.request(deps[dep], Req::All);
            }
        }

        // ES modules evaluate all their static dependencies (kept only if they have side effects
        // or something is used from them).
        for item in &esm.preamble {
            let dep = match item {
                PreambleItem::Import { dep, .. } => *dep,
                PreambleItem::Star(k) => esm.stars[*k].0,
            };
            self.request(deps[dep], Req::Evaluate);
        }

        self.usage[id] =
            ModuleUsage { all_exports: all, export_names: self.names[id].clone(), live_stmts: live, star_names };
    }
}
