//! `next/font/google` in production builds: like Next.js, the fonts are downloaded at build time
//! and served with the app (no request to Google, no layout shift while a third-party server
//! answers). The `@font-face` rules go into the app's CSS and the main font files are preloaded.
//!
//! Next.js requires font loaders to be called at the top level of a module with literal options
//! (`const inter = Inter({ subsets: ["latin"] })`): noru reads those calls from the source.
//! Downloads are cached in `node_modules/.noru-cache/fonts/` (later builds work offline).

use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;

use oxc::allocator::Allocator;
use oxc::ast::ast::*;
use oxc::parser::Parser;
use oxc::span::SourceType;

use crate::module::{content_hash, EmittedFile};

const DOWNLOADER: &str = include_str!("font-downloader.js");

/// Font loader calls found in the app: (font name, e.g. `Geist_Mono`, options).
#[derive(Default)]
pub struct GoogleFonts {
    calls: Mutex<Vec<(String, serde_json::Value)>>,
}

/// The self-hosted fonts, ready to be added to the build.
pub struct SelfHosted {
    /// `@font-face` rules (URLs point to `assets/`).
    pub css: String,
    pub files: Vec<EmittedFile>,
    /// Stylesheet URLs the browser runtime must not request from Google anymore.
    pub urls: Vec<String>,
    /// Font files to preload (`assets/...`).
    pub preload: Vec<String>,
}

impl GoogleFonts {
    /// Records the font loader calls of a module that imports `next/font/google`.
    pub fn scan(&self, path: &Path, source: &str) {
        if !source.contains("next/font/google") {
            return;
        }
        let allocator = Allocator::default();
        let source_type = SourceType::from_path(path).unwrap_or_default().with_module(true).with_jsx(true);
        let program = Parser::new(&allocator, source, source_type).parse().program;
        let mut loaders: HashMap<String, String> = HashMap::new();
        for statement in &program.body {
            if let Statement::ImportDeclaration(decl) = statement {
                if lossy(decl.source.value) != "next/font/google" {
                    continue;
                }
                for specifier in decl.specifiers.iter().flatten() {
                    if let ImportDeclarationSpecifier::ImportSpecifier(s) = specifier {
                        loaders.insert(s.local.name.to_string(), s.imported.name().to_string());
                    }
                }
            }
        }
        if loaders.is_empty() {
            return;
        }
        let mut found = Vec::new();
        for statement in &program.body {
            let declaration = match statement {
                Statement::VariableDeclaration(decl) => Some(&**decl),
                Statement::ExportDeclaration(export) => match &export.declaration {
                    Declaration::VariableDeclaration(decl) => Some(&**decl),
                    _ => None,
                },
                _ => None,
            };
            for declarator in declaration.into_iter().flat_map(|d| d.declarations.iter()) {
                let Some(Expression::CallExpression(call)) = &declarator.init else { continue };
                let Expression::Identifier(callee) = &call.callee else { continue };
                let Some(font) = loaders.get(callee.name.as_str()) else { continue };
                let options = call
                    .arguments
                    .first()
                    .and_then(|a| a.as_expression())
                    .and_then(literal)
                    .unwrap_or(serde_json::Value::Object(Default::default()));
                found.push((font.clone(), options));
            }
        }
        if let Ok(mut calls) = self.calls.lock() {
            calls.extend(found);
        }
    }

    /// Downloads the fonts (or takes them from the cache). Returns `None` when there are none.
    pub fn self_host(&self, root: &Path, base: &str) -> Result<Option<SelfHosted>, String> {
        let calls = self.calls.lock().map(|c| c.clone()).unwrap_or_default();
        if calls.is_empty() {
            return Ok(None);
        }
        let mut seen = HashSet::new();
        let mut requests = Vec::new();
        for (font, options) in &calls {
            let (url, fallback) = stylesheet_urls(font, options);
            if !seen.insert(url.clone()) {
                continue;
            }
            let subsets: Vec<String> = options
                .get("subsets")
                .and_then(|s| s.as_array())
                .map(|list| list.iter().filter_map(|s| s.as_str().map(String::from)).collect())
                .unwrap_or_default();
            let preload = options.get("preload").and_then(|p| p.as_bool()).unwrap_or(true);
            requests
                .push(serde_json::json!({ "url": url, "fallback": fallback, "subsets": subsets, "preload": preload }));
        }
        let cache_dir = root.join("node_modules/.noru-cache/fonts");
        let answer = run_downloader(root, &cache_dir, &serde_json::Value::Array(requests))?;
        let mut css = String::new();
        let mut files = Vec::new();
        let mut urls = Vec::new();
        let mut preload = Vec::new();
        let mut names: HashMap<String, String> = HashMap::new();
        for font in answer.as_array().into_iter().flatten() {
            let Some(text) = font.get("css").and_then(|c| c.as_str()) else { continue };
            let mut text = text.to_string();
            for file in font.get("files").and_then(|f| f.as_array()).into_iter().flatten() {
                let Some(cached) = file.as_str() else { continue };
                let name = match names.get(cached) {
                    Some(name) => name.clone(),
                    None => {
                        let bytes = std::fs::read(cache_dir.join(cached))
                            .map_err(|e| format!("font file {cached} is missing from the cache: {e}"))?;
                        let name = format!("assets/font-{}.woff2", content_hash(&bytes));
                        files.push(EmittedFile { file_name: name.clone(), contents: bytes });
                        names.insert(cached.to_string(), name.clone());
                        name
                    }
                };
                text = text.replace(&format!("__NORU_FONT__/{cached}"), &format!("{base}{name}"));
            }
            for file in font.get("preload").and_then(|f| f.as_array()).into_iter().flatten() {
                if let Some(name) = file.as_str().and_then(|f| names.get(f)) {
                    if preload.len() < 6 && !preload.contains(name) {
                        preload.push(name.clone());
                    }
                }
            }
            css.push_str(&text);
            css.push('\n');
            for key in ["url", "fallback"] {
                if let Some(url) = font.get(key).and_then(|u| u.as_str()) {
                    urls.push(url.to_string());
                }
            }
        }
        Ok(Some(SelfHosted { css, files, urls, preload }))
    }
}

fn run_downloader(root: &Path, cache_dir: &PathBuf, requests: &serde_json::Value) -> Result<serde_json::Value, String> {
    let node = std::env::var_os("NORU_NODE").unwrap_or_else(|| OsString::from("node"));
    let mut child = Command::new(&node)
        .arg("-e")
        .arg(DOWNLOADER)
        .arg(cache_dir)
        .current_dir(root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("cannot start Node.js to download the Google fonts: {e}"))?;
    {
        use std::io::Write;
        let mut stdin = child.stdin.take().ok_or("font downloader has no stdin")?;
        stdin.write_all(requests.to_string().as_bytes()).map_err(|e| e.to_string())?;
    }
    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let answer: serde_json::Value = serde_json::from_str(stdout.trim()).map_err(|_| {
        let stderr = String::from_utf8_lossy(&output.stderr);
        format!("could not download the Google fonts: {}", stderr.trim())
    })?;
    if let Some(error) = answer.get("error").and_then(|e| e.as_str()) {
        return Err(format!("could not download the Google fonts: {error}"));
    }
    Ok(answer.get("fonts").cloned().unwrap_or_default())
}

/// The value of a literal expression (`{ subsets: ["latin"], weight: "400" }`).
fn literal(expression: &Expression) -> Option<serde_json::Value> {
    use serde_json::Value;
    Some(match expression {
        Expression::StringLiteral(s) => Value::String(lossy(s.value)),
        Expression::NumericLiteral(n) if n.value.fract() == 0.0 => serde_json::json!(n.value as i64),
        Expression::NumericLiteral(n) => serde_json::json!(n.value),
        Expression::BooleanLiteral(b) => Value::Bool(b.value),
        Expression::NullLiteral(_) => Value::Null,
        Expression::TemplateLiteral(t) if t.expressions.is_empty() => {
            Value::String(t.quasis.iter().map(|q| q.value.raw.as_str()).collect())
        }
        Expression::ArrayExpression(array) => {
            Value::Array(array.elements.iter().filter_map(|e| e.as_expression()).filter_map(literal).collect())
        }
        Expression::ObjectExpression(object) => {
            let mut map = serde_json::Map::new();
            for property in &object.properties {
                let ObjectPropertyKind::ObjectProperty(p) = property else { continue };
                let key = match &p.key {
                    PropertyKey::StaticIdentifier(id) => id.name.to_string(),
                    PropertyKey::StringLiteral(s) => lossy(s.value),
                    _ => continue,
                };
                if let Some(value) = literal(&p.value) {
                    map.insert(key, value);
                }
            }
            Value::Object(map)
        }
        Expression::ParenthesizedExpression(p) => return literal(&p.expression),
        Expression::TSAsExpression(e) => return literal(&e.expression),
        Expression::TSSatisfiesExpression(e) => return literal(&e.expression),
        _ => return None,
    })
}

fn lossy(s: oxc::str::JSStr<'_>) -> String {
    match s.as_str() {
        Some(s) => s.to_string(),
        None => s.display().to_string(),
    }
}

fn strings(value: Option<&serde_json::Value>) -> Vec<String> {
    match value {
        Some(serde_json::Value::Array(list)) => list
            .iter()
            .filter_map(|v| match v {
                serde_json::Value::String(s) => Some(s.clone()),
                serde_json::Value::Number(n) => Some(n.to_string()),
                _ => None,
            })
            .collect(),
        Some(serde_json::Value::String(s)) => vec![s.clone()],
        Some(serde_json::Value::Number(n)) => vec![n.to_string()],
        _ => Vec::new(),
    }
}

/// The Google Fonts stylesheet URLs requested by the browser runtime (`font-google.js`, keep in
/// sync): the URL with the weights, and the one without (when the font has no such weights).
pub fn stylesheet_urls(font: &str, options: &serde_json::Value) -> (String, String) {
    let family = font.replace('_', " ");
    let mut weights: Vec<String> = strings(options.get("weight")).into_iter().filter(|w| w != "variable").collect();
    let italic = strings(options.get("style")).iter().any(|s| s == "italic");
    let axes = if weights.is_empty() {
        if italic {
            ":ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600;1,700".to_string()
        } else {
            ":wght@400;500;600;700".to_string()
        }
    } else {
        weights.sort_by(|a, b| {
            a.parse::<f64>()
                .unwrap_or(0.0)
                .partial_cmp(&b.parse::<f64>().unwrap_or(0.0))
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        if italic {
            let normal = weights.iter().map(|w| format!("0,{w}"));
            let slanted = weights.iter().map(|w| format!("1,{w}"));
            format!(":ital,wght@{}", normal.chain(slanted).collect::<Vec<_>>().join(";"))
        } else {
            format!(":wght@{}", weights.join(";"))
        }
    };
    let display = options.get("display").and_then(|d| d.as_str()).unwrap_or("swap");
    let family_param = encode_component(&family).replace("%20", "+");
    let base = format!("https://fonts.googleapis.com/css2?family={family_param}");
    (format!("{base}{axes}&display={display}"), format!("{base}&display={display}"))
}

/// Like JavaScript's `encodeURIComponent`.
fn encode_component(text: &str) -> String {
    let mut out = String::new();
    for byte in text.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_font_calls_and_builds_urls() {
        let fonts = GoogleFonts::default();
        fonts.scan(
            Path::new("app/layout.tsx"),
            "import { Geist, Roboto_Mono as Mono } from 'next/font/google'\nconst geist = Geist({ subsets: ['latin'], variable: '--font-geist' })\nexport const mono = Mono({ weight: ['700', '400'], style: ['italic'], display: 'optional' } as const)\n",
        );
        let calls = fonts.calls.lock().unwrap().clone();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].0, "Geist");
        assert_eq!(calls[0].1["subsets"][0], "latin");
        let (url, fallback) = stylesheet_urls(&calls[1].0, &calls[1].1);
        assert_eq!(
            url,
            "https://fonts.googleapis.com/css2?family=Roboto+Mono:ital,wght@0,400;0,700;1,400;1,700&display=optional"
        );
        assert_eq!(fallback, "https://fonts.googleapis.com/css2?family=Roboto+Mono&display=optional");
        let (url, _) = stylesheet_urls("Geist", &calls[0].1);
        assert_eq!(url, "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap");
    }
}
