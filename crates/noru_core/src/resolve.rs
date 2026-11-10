//! Module resolution (node_modules, package.json `exports`, tsconfig `paths`...) on top of `oxc_resolver`.

use std::path::{Path, PathBuf};

use oxc_resolver::{ResolveError, ResolveOptions, Resolver, TsconfigDiscovery};

use crate::module::ModuleKey;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResolveKind {
    /// `import` / `export ... from` / `import()`
    Import,
    /// `require()`
    Require,
    /// `@import` / `url()` in CSS
    Css,
}

pub struct Resolved {
    pub key: ModuleKey,
    pub warning: Option<String>,
}

pub struct NoruResolver {
    import: Resolver,
    require: Resolver,
    css: Resolver,
}

impl NoruResolver {
    pub fn new(root: &Path, production: bool) -> Self {
        let mode_condition = if production { "production" } else { "development" };
        let base = ResolveOptions {
            extensions: [".mjs", ".js", ".mts", ".ts", ".jsx", ".tsx", ".json"].map(String::from).to_vec(),
            extension_alias: vec![
                (".js".into(), vec![".ts".into(), ".tsx".into(), ".js".into(), ".jsx".into()]),
                (".jsx".into(), vec![".tsx".into(), ".jsx".into()]),
                (".mjs".into(), vec![".mts".into(), ".mjs".into()]),
            ],
            condition_names: ["browser", "import", "module", "default", mode_condition].map(String::from).to_vec(),
            main_fields: ["browser", "module", "jsnext:main", "jsnext", "main"].map(String::from).to_vec(),
            alias_fields: vec![vec!["browser".into()]],
            roots: vec![root.to_path_buf()],
            tsconfig: Some(TsconfigDiscovery::Auto),
            builtin_modules: true,
            ..ResolveOptions::default()
        };
        let import = Resolver::new(base.clone());
        let require = import.clone_with_options(ResolveOptions {
            condition_names: ["browser", "require", "module", "default", mode_condition].map(String::from).to_vec(),
            ..base.clone()
        });
        let css = import.clone_with_options(ResolveOptions {
            condition_names: ["style", "browser", "import", "default"].map(String::from).to_vec(),
            main_fields: ["style", "browser", "module", "main"].map(String::from).to_vec(),
            extensions: vec![".css".into()],
            main_files: vec!["index".into()],
            prefer_relative: true,
            ..base
        });
        Self { import, require, css }
    }

    pub fn resolve(&self, importer: &Path, specifier: &str, kind: ResolveKind) -> Result<Resolved, String> {
        if is_external_url(specifier) {
            return Err(format!("external URL imports are not supported yet: \"{specifier}\""));
        }
        let resolver = match kind {
            ResolveKind::Import => &self.import,
            ResolveKind::Require => &self.require,
            ResolveKind::Css => &self.css,
        };
        match resolver.resolve_file(importer, specifier) {
            Ok(resolution) => {
                let query = resolution.query().map(str::to_string);
                Ok(Resolved { key: ModuleKey::new(clean_path(resolution.path()), query), warning: None })
            }
            Err(ResolveError::Ignored(_)) => Ok(Resolved { key: ModuleKey::empty(), warning: None }),
            Err(ResolveError::Builtin { resolved, .. }) => Ok(Resolved {
                key: ModuleKey::empty(),
                warning: Some(format!(
                    "\"{resolved}\" is a Node.js built-in module and was replaced by an empty module for the browser"
                )),
            }),
            Err(err) => Err(format!("cannot resolve \"{specifier}\": {err}")),
        }
    }
}

pub fn is_external_url(specifier: &str) -> bool {
    specifier.starts_with("http://")
        || specifier.starts_with("https://")
        || specifier.starts_with("//")
        || specifier.starts_with("data:")
}

/// Removes the `\\?\` verbatim prefix Windows sometimes adds after canonicalization.
fn clean_path(path: &Path) -> PathBuf {
    let s = path.to_string_lossy();
    match s.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with("UNC\\") => PathBuf::from(rest),
        _ => path.to_path_buf(),
    }
}
