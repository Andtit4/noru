//! `package.json` `"sideEffects"` field: lets packages declare that their modules can be dropped
//! when none of their exports are used (essential for tree-shaking libraries like lodash-es).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use regex::Regex;

#[derive(Debug)]
enum SideEffects {
    /// No package.json, or no `sideEffects` field.
    Unknown,
    Flag(bool),
    /// Only files matching these patterns have side effects.
    Patterns {
        root: PathBuf,
        patterns: Vec<Regex>,
    },
}

/// Caches the nearest-`package.json` lookup per directory.
#[derive(Default)]
pub struct PackageCache {
    dirs: Mutex<HashMap<PathBuf, Arc<SideEffects>>>,
}

impl PackageCache {
    /// `Some(false)`: the package says this file has no side effects. `Some(true)`: it has.
    /// `None`: unknown (the module is analyzed instead).
    pub fn side_effects(&self, file: &Path) -> Option<bool> {
        let dir = file.parent()?;
        match &*self.for_dir(dir) {
            SideEffects::Unknown => None,
            SideEffects::Flag(flag) => Some(*flag),
            SideEffects::Patterns { root, patterns } => {
                let rel = file.strip_prefix(root).unwrap_or(file).to_string_lossy().replace('\\', "/");
                Some(patterns.iter().any(|p| p.is_match(&rel)))
            }
        }
    }

    fn for_dir(&self, dir: &Path) -> Arc<SideEffects> {
        if let Some(found) = self.dirs.lock().ok().and_then(|d| d.get(dir).cloned()) {
            return found;
        }
        let manifest = dir.join("package.json");
        let value = if manifest.is_file() {
            Arc::new(read_side_effects(&manifest, dir))
        } else {
            match dir.parent() {
                Some(parent) if parent != dir => self.for_dir(parent),
                _ => Arc::new(SideEffects::Unknown),
            }
        };
        if let Ok(mut dirs) = self.dirs.lock() {
            dirs.insert(dir.to_path_buf(), Arc::clone(&value));
        }
        value
    }
}

fn read_side_effects(manifest: &Path, root: &Path) -> SideEffects {
    let Ok(text) = std::fs::read_to_string(manifest) else { return SideEffects::Unknown };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) else { return SideEffects::Unknown };
    match json.get("sideEffects") {
        Some(serde_json::Value::Bool(flag)) => SideEffects::Flag(*flag),
        Some(serde_json::Value::Array(items)) => {
            let patterns = items.iter().filter_map(|v| v.as_str()).filter_map(glob_to_regex).collect();
            SideEffects::Patterns { root: root.to_path_buf(), patterns }
        }
        _ => SideEffects::Unknown,
    }
}

/// Converts a `sideEffects` glob to a regex, with webpack's semantics: patterns without a `/`
/// match in any folder (`*.css` = `**/*.css`), paths are relative to the package root.
fn glob_to_regex(glob: &str) -> Option<Regex> {
    let mut glob = glob.trim_start_matches("./").to_string();
    if !glob.contains('/') {
        glob = format!("**/{glob}");
    }
    let mut re = String::from("^");
    let chars: Vec<char> = glob.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        match chars[i] {
            '*' if chars.get(i + 1) == Some(&'*') => {
                if chars.get(i + 2) == Some(&'/') {
                    re.push_str("(?:.*/)?");
                    i += 3;
                } else {
                    re.push_str(".*");
                    i += 2;
                }
                continue;
            }
            '*' => re.push_str("[^/]*"),
            '?' => re.push_str("[^/]"),
            '{' => re.push_str("(?:"),
            '}' => re.push(')'),
            ',' => re.push('|'),
            c => re.push_str(&regex::escape(&c.to_string())),
        }
        i += 1;
    }
    re.push('$');
    Regex::new(&re).ok()
}

#[cfg(test)]
mod tests {
    use super::glob_to_regex;

    #[test]
    fn globs_follow_webpack_semantics() {
        let css = glob_to_regex("*.css").unwrap();
        assert!(css.is_match("dist/styles/main.css"));
        assert!(css.is_match("main.css"));
        assert!(!css.is_match("main.js"));
        let file = glob_to_regex("./src/polyfill.js").unwrap();
        assert!(file.is_match("src/polyfill.js"));
        assert!(!file.is_match("lib/src/polyfill.js"));
        let deep = glob_to_regex("dist/**/*.{css,scss}").unwrap();
        assert!(deep.is_match("dist/a/b/c.scss"));
        assert!(deep.is_match("dist/c.css"));
    }
}
