//! Shared building blocks: module identity, code templates and text edits.

use std::path::{Path, PathBuf};

/// Unique identity of a module in the graph: an absolute path plus an optional query (`?raw`, `?url`...).
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct ModuleKey {
    pub path: PathBuf,
    pub query: Option<String>,
}

impl ModuleKey {
    pub fn new(path: PathBuf, query: Option<String>) -> Self {
        let query = query.filter(|q| !q.is_empty() && q != "?");
        Self { path, query }
    }

    /// Virtual module used for `browser: false` fields and Node.js built-ins.
    pub fn empty() -> Self {
        Self { path: PathBuf::from("\0noru-empty"), query: None }
    }

    pub fn is_empty_module(&self) -> bool {
        self.path.as_os_str() == "\0noru-empty"
    }

    pub fn has_query(&self, name: &str) -> bool {
        self.query.as_deref().is_some_and(|q| {
            q.trim_start_matches('?').split('&').any(|part| part == name || part.starts_with(&format!("{name}=")))
        })
    }

    pub fn extension(&self) -> String {
        self.path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase()
    }

    pub fn is_in_node_modules(&self) -> bool {
        self.path.components().any(|c| c.as_os_str() == "node_modules")
    }

    /// Path relative to `root`, with forward slashes (for comments and messages).
    pub fn display(&self, root: &Path) -> String {
        if self.is_empty_module() {
            return "(empty)".to_string();
        }
        let rel = self.path.strip_prefix(root).unwrap_or(&self.path);
        let mut s = rel.to_string_lossy().replace('\\', "/");
        if let Some(q) = &self.query {
            s.push_str(q);
        }
        s
    }
}

/// A piece of generated code: literal text, or a reference to the n-th dependency of the module
/// (replaced by the dependency's numeric id once the whole graph is known).
#[derive(Debug, Clone)]
pub enum Part {
    Text(String),
    Dep(usize),
}

#[derive(Debug, Clone, Default)]
pub struct Template {
    pub parts: Vec<Part>,
}

impl Template {
    pub fn push_str(&mut self, s: &str) {
        if s.is_empty() {
            return;
        }
        if let Some(Part::Text(t)) = self.parts.last_mut() {
            t.push_str(s);
        } else {
            self.parts.push(Part::Text(s.to_string()));
        }
    }

    pub fn push_dep(&mut self, dep: usize) {
        self.parts.push(Part::Dep(dep));
    }

    pub fn extend(&mut self, parts: &[Part]) {
        for part in parts {
            match part {
                Part::Text(t) => self.push_str(t),
                Part::Dep(d) => self.push_dep(*d),
            }
        }
    }

    /// Writes the code, replacing each dependency by its id (`-1` if it is not in the bundle).
    pub fn render(&self, out: &mut String, dep_id: impl Fn(usize) -> Option<usize>) {
        for part in &self.parts {
            match part {
                Part::Text(t) => out.push_str(t),
                Part::Dep(d) => match dep_id(*d) {
                    Some(id) => out.push_str(&id.to_string()),
                    None => out.push_str("-1"),
                },
            }
        }
    }
}

/// Replace the byte range `start..end` of the source with `parts`.
#[derive(Debug, Clone)]
pub struct Edit {
    pub start: u32,
    pub end: u32,
    pub parts: Vec<Part>,
}

impl Edit {
    pub fn replace(start: u32, end: u32, text: impl Into<String>) -> Self {
        let text = text.into();
        let parts = if text.is_empty() { vec![] } else { vec![Part::Text(text)] };
        Self { start, end, parts }
    }

    pub fn remove(start: u32, end: u32) -> Self {
        Self { start, end, parts: vec![] }
    }

    pub fn with_parts(start: u32, end: u32, parts: Vec<Part>) -> Self {
        Self { start, end, parts }
    }
}

/// Applies non-overlapping edits to `source`, appending the result to `out`.
/// When two edits overlap, the one that starts first (or is longer) wins and the other is dropped:
/// this is what we want for e.g. a reference inside a removed `export { a }` statement.
#[cfg(test)]
pub fn apply_edits(source: &str, edits: Vec<Edit>, out: &mut Template) {
    apply_edits_in(source, 0, source.len(), edits, out);
}

/// Same as [`apply_edits`], restricted to the byte range `from..to` of `source`
/// (edit positions are absolute; edits outside the range are ignored).
pub fn apply_edits_in(source: &str, from: usize, to: usize, mut edits: Vec<Edit>, out: &mut Template) {
    edits.sort_by(|a, b| {
        a.start.cmp(&b.start).then_with(|| (a.start != a.end).cmp(&(b.start != b.end))).then_with(|| b.end.cmp(&a.end))
    });
    let mut cursor = from;
    for edit in edits {
        let (start, end) = (edit.start as usize, edit.end as usize);
        if start < cursor || end > to {
            continue;
        }
        out.push_str(&source[cursor..start]);
        out.extend(&edit.parts);
        cursor = end;
    }
    out.push_str(&source[cursor..to]);
}

/// A file written to the output directory (asset, chunk...).
#[derive(Debug, Clone)]
pub struct EmittedFile {
    /// Path relative to the output directory, with forward slashes.
    pub file_name: String,
    pub contents: Vec<u8>,
}

/// Short content hash used in file names.
pub fn content_hash(bytes: &[u8]) -> String {
    let hash = xxhash_rust::xxh3::xxh3_64(bytes);
    format!("{hash:016x}")[..8].to_string()
}

/// `obj.name`, or `obj["name"]` when `name` is not a valid identifier.
pub fn member_access(object: &str, name: &str) -> String {
    if is_identifier_name(name) {
        format!("{object}.{name}")
    } else {
        format!("{object}[{}]", serde_json::to_string(name).unwrap_or_default())
    }
}

pub fn is_identifier_name(name: &str) -> bool {
    let mut chars = name.chars();
    match chars.next() {
        Some(c) if c == '_' || c == '$' || c.is_ascii_alphabetic() => {}
        _ => return false,
    }
    chars.all(|c| c == '_' || c == '$' || c.is_ascii_alphanumeric())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn edits_apply_in_order_and_skip_overlaps() {
        let src = "abcdefghij";
        let edits =
            vec![Edit::replace(2, 4, "X"), Edit::replace(3, 4, "never"), Edit::replace(8, 8, "+"), Edit::remove(0, 1)];
        let mut t = Template::default();
        apply_edits(src, edits, &mut t);
        let mut out = String::new();
        t.render(&mut out, Some);
        assert_eq!(out, "bXefgh+ij");
    }

    #[test]
    fn member_access_quotes_when_needed() {
        assert_eq!(member_access("m", "default"), "m.default");
        assert_eq!(member_access("m", "a-b"), "m[\"a-b\"]");
    }
}
