//! Pre-rendering: `noru build` renders the static pages of a Next.js app to HTML with Node.js
//! (`prerender-runner.js`), so that the content shows up before the JavaScript has downloaded —
//! what matters most on a slow connection. The browser app then takes over.
//!
//! Pages that cannot be rendered at build time (they fetch relative URLs, read cookies, call
//! `redirect()`...) are skipped: they keep the empty app shell, like without pre-rendering.

use std::ffi::OsString;
use std::path::Path;
use std::process::{Command, Stdio};

const RUNNER: &str = include_str!("prerender-runner.js");
const MARKER: &str = "\u{0}noru-prerender:";

/// A page rendered to HTML.
pub struct Prerendered {
    pub route: String,
    pub html: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub html_attrs: Vec<(String, String)>,
    pub body_attrs: Vec<(String, String)>,
}

/// Pages that were not pre-rendered: (route, why).
pub type Skipped = Vec<(String, String)>;

/// Renders `routes` with the pre-render bundle. Returns the pages and, for the others, why not.
pub fn render(root: &Path, bundle: &str, routes: &[String]) -> Result<(Vec<Prerendered>, Skipped), String> {
    let dir = root.join("node_modules/.noru-cache");
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    let bundle_file = dir.join("prerender.js");
    std::fs::write(&bundle_file, bundle).map_err(|e| format!("cannot write {}: {e}", bundle_file.display()))?;

    let node = std::env::var_os("NORU_NODE").unwrap_or_else(|| OsString::from("node"));
    let mut child = Command::new(&node)
        .arg("-e")
        .arg(RUNNER)
        .arg(&bundle_file)
        .current_dir(root)
        .env("NODE_ENV", "production")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| format!("cannot start Node.js to pre-render the pages: {e}"))?;
    {
        use std::io::Write;
        let request = serde_json::json!({ "origin": "http://localhost", "routes": routes });
        let mut stdin = child.stdin.take().ok_or("pre-render: no stdin")?;
        stdin.write_all(request.to_string().as_bytes()).map_err(|e| e.to_string())?;
    }
    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&bundle_file);

    let attrs = |value: Option<&serde_json::Value>| -> Vec<(String, String)> {
        value
            .and_then(|v| v.as_object())
            .map(|map| map.iter().filter_map(|(k, v)| Some((k.clone(), v.as_str()?.to_string()))).collect())
            .unwrap_or_default()
    };
    let mut pages = Vec::new();
    let mut skipped = Vec::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let Some(json) = line.strip_prefix(MARKER) else { continue };
        let Ok(answer) = serde_json::from_str::<serde_json::Value>(json) else { continue };
        let route = answer.get("route").and_then(|r| r.as_str()).unwrap_or("").to_string();
        if let Some(error) = answer.get("error").and_then(|e| e.as_str()) {
            skipped.push((route, error.to_string()));
            continue;
        }
        let text = |key: &str| answer.get(key).and_then(|v| v.as_str()).map(String::from);
        pages.push(Prerendered {
            route,
            html: text("html").unwrap_or_default(),
            title: text("title"),
            description: text("description"),
            html_attrs: attrs(answer.get("htmlAttrs")),
            body_attrs: attrs(answer.get("bodyAttrs")),
        });
    }
    for route in routes {
        if !pages.iter().any(|p| &p.route == route) && !skipped.iter().any(|(r, _)| r == route) {
            skipped.push((route.clone(), "Node.js stopped before rendering it".to_string()));
        }
    }
    Ok((pages, skipped))
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

fn attributes(attrs: &[(String, String)]) -> String {
    attrs
        .iter()
        .filter(|(name, _)| name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b':'))
        .map(
            |(name, value)| {
                if value.is_empty() {
                    format!(" {name}")
                } else {
                    format!(" {name}=\"{}\"", escape(value))
                }
            },
        )
        .collect()
}

/// The HTML file of a page: the app shell with the rendered content, title and attributes.
pub fn page_html(shell: &str, page: &Prerendered) -> String {
    let mut html = shell.replacen(
        "<div id=\"__next\" style=\"display: contents\"></div>",
        &format!("<div id=\"__next\" style=\"display: contents\">{}</div>", page.html),
        1,
    );
    let mut head = String::new();
    if let Some(title) = &page.title {
        head.push_str(&format!("    <title>{}</title>\n", escape(title)));
    }
    if let Some(description) = &page.description {
        head.push_str(&format!("    <meta name=\"description\" content=\"{}\" />\n", escape(description)));
    }
    if !head.is_empty() {
        if let Some(index) = html.find("  </head>") {
            html.insert_str(index, &head);
        }
    }
    if !page.html_attrs.is_empty() {
        html = html.replacen("<html>", &format!("<html{}>", attributes(&page.html_attrs)), 1);
    }
    if !page.body_attrs.is_empty() {
        html = html.replacen("<body>", &format!("<body{}>", attributes(&page.body_attrs)), 1);
    }
    html
}

/// `dist/` file of a route: `/` -> `index.html`, `/blog` -> `blog/index.html`.
pub fn file_name(route: &str) -> String {
    let path = route.trim_matches('/');
    if path.is_empty() {
        "index.html".to_string()
    } else {
        format!("{path}/index.html")
    }
}
