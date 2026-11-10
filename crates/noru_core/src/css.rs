//! CSS files: parsed, minified and analyzed with Lightning CSS.
//! `@import`s become graph dependencies (inlined in order), `url()`s are emitted as assets,
//! and `*.module.css` files get scoped class names exported to JavaScript.

use std::path::Path;

use lightningcss::css_modules::{Config as CssModulesConfig, CssModuleReference};
use lightningcss::dependencies::{Dependency, DependencyOptions};
use lightningcss::stylesheet::{MinifyOptions, ParserOptions, PrinterOptions, StyleSheet};

use crate::asset::{process_asset, AssetOptions};
use crate::module::{EmittedFile, ModuleKey};
use crate::resolve::is_external_url;

pub struct CssOutput {
    pub code: String,
    /// Files pulled in with `@import`, in order.
    pub imports: Vec<ModuleKey>,
    /// For CSS modules: a JS object literal mapping local class names to scoped ones.
    pub module_exports: Option<String>,
    pub emitted: Vec<EmittedFile>,
    pub warnings: Vec<String>,
}

pub fn is_css_module(path: &Path) -> bool {
    path.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.ends_with(".module.css"))
}

pub fn process_css(
    path: &Path,
    source: &str,
    minify: bool,
    assets: &AssetOptions,
    resolve: &dyn Fn(&str) -> Result<ModuleKey, String>,
) -> Result<CssOutput, String> {
    let filename = path.to_string_lossy().to_string();
    let css_modules = is_css_module(path).then(CssModulesConfig::default);
    let options = ParserOptions { filename: filename.clone(), css_modules, ..ParserOptions::default() };
    let mut sheet = StyleSheet::parse(source, options).map_err(|e| format!("CSS error in {filename}: {e}"))?;
    if minify {
        sheet.minify(MinifyOptions::default()).map_err(|e| format!("CSS minify error in {filename}: {e}"))?;
    }
    let result = sheet
        .to_css(PrinterOptions {
            minify,
            analyze_dependencies: Some(DependencyOptions { remove_imports: true }),
            ..PrinterOptions::default()
        })
        .map_err(|e| format!("CSS print error in {filename}: {e}"))?;

    let mut code = result.code;
    let mut imports = Vec::new();
    let mut emitted = Vec::new();
    let mut warnings = Vec::new();
    let dir = path.parent().unwrap_or(Path::new("."));

    for dep in result.dependencies.unwrap_or_default() {
        match dep {
            Dependency::Import(import) => {
                if import.media.is_some() || import.supports.is_some() {
                    warnings.push(format!(
                        "@import \"{}\" media/supports conditions are not supported yet and were ignored ({filename})",
                        import.url
                    ));
                }
                if is_external_url(&import.url) {
                    warnings.push(format!("external @import \"{}\" was removed ({filename})", import.url));
                    continue;
                }
                match resolve(&import.url) {
                    Ok(key) => imports.push(key),
                    Err(e) => return Err(format!("{e}\n    @import in {filename}")),
                }
            }
            Dependency::Url(url) => {
                let raw = url.url.as_str();
                let replacement = if is_external_url(raw) || raw.starts_with('#') {
                    raw.to_string()
                } else if let Some(public) = raw.strip_prefix('/') {
                    // Served from the public directory.
                    format!("{}{public}", assets.base)
                } else {
                    let clean = raw.split(['?', '#']).next().unwrap_or(raw);
                    let candidate = dir.join(clean);
                    let resolved =
                        if candidate.is_file() { Some(candidate) } else { resolve(clean).ok().map(|k| k.path) };
                    match resolved {
                        Some(asset_path) => {
                            let (asset_url, file) = process_asset(&asset_path, assets)?;
                            emitted.extend(file);
                            asset_url
                        }
                        None => {
                            warnings.push(format!("url({raw}) in {filename} could not be resolved and was left as-is"));
                            raw.to_string()
                        }
                    }
                };
                // Lightning CSS prints the placeholder either quoted (`url("ph")`) or bare (`url(ph)`).
                let quoted = serde_json::to_string(&replacement).unwrap_or_default();
                code = code.replace(&format!("\"{}\"", url.placeholder), &quoted);
                code = code.replace(&url.placeholder, &quoted);
            }
        }
    }

    let module_exports = result.exports.map(|exports| {
        let mut entries: Vec<_> = exports.into_iter().collect();
        entries.sort_by(|a, b| a.0.cmp(&b.0));
        let mut object = serde_json::Map::new();
        for (local, export) in entries {
            let mut classes = vec![export.name.clone()];
            for composed in &export.composes {
                match composed {
                    CssModuleReference::Local { name } | CssModuleReference::Global { name } => {
                        classes.push(name.clone())
                    }
                    CssModuleReference::Dependency { name, specifier } => warnings
                        .push(format!("`composes: {name} from \"{specifier}\"` is not supported yet ({filename})")),
                }
            }
            object.insert(local, classes.join(" ").into());
        }
        serde_json::Value::Object(object).to_string()
    });

    Ok(CssOutput { code, imports, module_exports, emitted, warnings })
}
