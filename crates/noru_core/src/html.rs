//! `index.html` handling: finds the entry scripts/stylesheets and injects the built files.

use std::path::Path;
use std::sync::LazyLock;

use regex::Regex;

static SCRIPT_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?is)<script\b([^>]*)>(.*?)</script\s*>").unwrap());
static LINK_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?is)<link\b([^>]*?)/?>").unwrap());
static ATTR_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?is)([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))"#).unwrap()
});
static ABS_URL_ATTR_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?i)\b(src|href)\s*=\s*(["'])/([^/"'][^"']*)?(["'])"#).unwrap());

fn attr(attrs: &str, name: &str) -> Option<String> {
    ATTR_RE.captures_iter(attrs).find_map(|c| {
        if c[1].eq_ignore_ascii_case(name) {
            Some(c.get(2).or(c.get(3)).or(c.get(4)).map(|m| m.as_str().to_string()).unwrap_or_default())
        } else {
            None
        }
    })
}

fn is_local(url: &str) -> bool {
    !(url.starts_with("http://") || url.starts_with("https://") || url.starts_with("//") || url.starts_with("data:"))
}

pub struct HtmlEntries {
    /// `src` of `<script type="module" src="...">` tags, in order.
    pub scripts: Vec<String>,
    /// `href` of local `<link rel="stylesheet">` tags that point to project files (not `public/`).
    pub styles: Vec<String>,
}

/// Turns an URL found in the HTML into a file path inside `root`.
pub fn url_to_path(root: &Path, url: &str) -> std::path::PathBuf {
    let clean = url.split(['?', '#']).next().unwrap_or(url);
    let clean = clean.trim_start_matches("./").trim_start_matches('/');
    crate::options::normalize_path(&root.join(clean))
}

pub fn find_entries(html: &str, root: &Path, public_dir: &Path) -> HtmlEntries {
    let mut scripts = Vec::new();
    for cap in SCRIPT_RE.captures_iter(html) {
        let attrs = &cap[1];
        let is_module = attr(attrs, "type").is_some_and(|t| t.eq_ignore_ascii_case("module"));
        if let (true, Some(src)) = (is_module, attr(attrs, "src")) {
            if is_local(&src) {
                scripts.push(src);
            }
        }
    }
    let mut styles = Vec::new();
    for cap in LINK_RE.captures_iter(html) {
        let attrs = &cap[1];
        let is_stylesheet = attr(attrs, "rel").is_some_and(|r| r.eq_ignore_ascii_case("stylesheet"));
        if let (true, Some(href)) = (is_stylesheet, attr(attrs, "href")) {
            if is_local(&href) && !url_to_path(public_dir, &href).is_file() && url_to_path(root, &href).is_file() {
                styles.push(href);
            }
        }
    }
    HtmlEntries { scripts, styles }
}

/// Removes the source entry tags and injects `tags` (one tag per line) before `</head>`.
/// Absolute URLs pointing to `public/` files are prefixed with `base`.
pub fn rewrite_html(html: &str, entries: &HtmlEntries, tags: &str, base: &str) -> String {
    let without_scripts = SCRIPT_RE.replace_all(html, |cap: &regex::Captures| {
        let attrs = &cap[1];
        let is_module = attr(attrs, "type").is_some_and(|t| t.eq_ignore_ascii_case("module"));
        match attr(attrs, "src") {
            Some(src) if is_module && entries.scripts.contains(&src) => String::new(),
            _ => cap[0].to_string(),
        }
    });
    let without_links = LINK_RE.replace_all(&without_scripts, |cap: &regex::Captures| {
        let attrs = &cap[1];
        let is_stylesheet = attr(attrs, "rel").is_some_and(|r| r.eq_ignore_ascii_case("stylesheet"));
        match attr(attrs, "href") {
            Some(href) if is_stylesheet && entries.styles.contains(&href) => String::new(),
            _ => cap[0].to_string(),
        }
    });

    let mut html = without_links.into_owned();
    if base != "/" {
        html = ABS_URL_ATTR_RE
            .replace_all(&html, |cap: &regex::Captures| {
                let rest = cap.get(3).map(|m| m.as_str()).unwrap_or("");
                format!("{}={}{base}{rest}{}", &cap[1], &cap[2], &cap[4])
            })
            .into_owned();
    }

    match find_ci(&html, "</head>") {
        Some(idx) => {
            // Insert on its own line, before the indentation of `</head>`.
            let line_start = html[..idx].rfind('\n').map_or(0, |i| i + 1);
            let at = if html[line_start..idx].trim().is_empty() { line_start } else { idx };
            html.insert_str(at, tags);
        }
        None => html.insert_str(0, tags),
    }
    // Drop the blank lines left by removed tags.
    let cleaned: Vec<&str> = html.lines().filter(|l| !l.trim().is_empty()).collect();
    cleaned.join("\n") + "\n"
}

fn find_ci(haystack: &str, needle: &str) -> Option<usize> {
    haystack.to_ascii_lowercase().find(&needle.to_ascii_lowercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    const HTML: &str = r#"<!doctype html>
<html lang="en">
  <head>
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <title>App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>"#;

    #[test]
    fn finds_and_rewrites_entries() {
        let root = Path::new("/nonexistent");
        let entries = find_entries(HTML, root, &root.join("public"));
        assert_eq!(entries.scripts, vec!["/src/main.tsx".to_string()]);
        let tags = "    <script type=\"module\" src=\"/assets/index-1.js\"></script>\n";
        let out = rewrite_html(HTML, &entries, tags, "/");
        assert!(!out.contains("main.tsx"));
        assert!(out.contains("    <script type=\"module\" src=\"/assets/index-1.js\"></script>\n  </head>"));
        assert!(out.contains(r#"href="/vite.svg""#));
    }

    #[test]
    fn prefixes_public_urls_with_base() {
        let entries = HtmlEntries { scripts: vec![], styles: vec![] };
        let out = rewrite_html(HTML, &entries, "", "/app/");
        assert!(out.contains(r#"href="/app/vite.svg""#));
    }
}
