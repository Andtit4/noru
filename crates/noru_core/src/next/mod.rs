//! Next.js App Router projects, run entirely in the browser (no server).
//!
//! When a project has no `index.html` but depends on `next` and has an `app/` directory, noru
//! reads that directory (layouts, pages, loading / error / not-found files, dynamic segments...)
//! and generates a route tree module. A small client-side router (`runtime/router.js`) renders it,
//! and the `next/*` modules are replaced by browser versions (`next/link`, `next/navigation`,
//! `next/image`, `next/font/google`...). All generated modules are virtual: they only exist in
//! memory, under `node_modules/.noru-next/`, nothing is written to the project.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::options::normalize_path;

/// Directory (that does not exist on disk) holding the generated modules.
const VIRTUAL_DIR: &str = "node_modules/.noru-next";

/// JSX goes through noru's runtime, which handles `<html>` / `<body>` and async components.
pub const JSX_IMPORT_SOURCE: &str = "noru-next-jsx";

/// The page served for every route; the root layout fills it.
pub const HTML: &str = "<!doctype html>
<html>
  <head>
    <meta charset=\"utf-8\" />
    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
  </head>
  <body>
    <div id=\"__next\" style=\"display: contents\"></div>
  </body>
</html>
";

const ENTRY: &str = "import { start } from \"noru-next/router\";
import * as routes from \"noru-next/routes\";
start(routes);
";

const SINGLE_FILE_MODULES: &[(&str, &str)] = &[
    ("router.js", include_str!("runtime/router.js")),
    ("jsx-runtime.js", include_str!("runtime/jsx-runtime.js")),
    ("navigation.js", include_str!("runtime/navigation.js")),
    ("link.js", include_str!("runtime/link.js")),
    ("image.js", include_str!("runtime/image.js")),
    ("font-google.js", include_str!("runtime/font-google.js")),
];

/// Several small modules in one file, separated by `// @module <name>` lines.
const MISC_MODULES: &str = include_str!("runtime/misc.js");

/// Module specifiers served by the browser runtime.
const ALIASES: &[(&str, &str)] = &[
    ("next/link", "link.js"),
    ("next/navigation", "navigation.js"),
    ("next/image", "image.js"),
    ("next/legacy/image", "image.js"),
    ("next/font/google", "font-google.js"),
    ("next/font/local", "font-local.js"),
    ("next/dynamic", "dynamic.js"),
    ("next/head", "head.js"),
    ("next/script", "script.js"),
    ("next/headers", "headers.js"),
    ("next/router", "pages-router.js"),
    ("next/server", "server.js"),
    ("next/cache", "cache.js"),
    ("next/config", "config.js"),
    ("next/form", "form.js"),
    ("next", "empty.js"),
    ("server-only", "empty.js"),
    ("client-only", "empty.js"),
    ("noru-next-jsx", "jsx-runtime.js"),
    ("noru-next-jsx/jsx-runtime", "jsx-runtime.js"),
    ("noru-next-jsx/jsx-dev-runtime", "jsx-runtime.js"),
    ("noru-next/router", "router.js"),
    ("noru-next/routes", "routes.js"),
];

/// `next/*` modules without a browser version: importing them works, using them throws.
const UNSUPPORTED_MODULE: &str = "\"use strict\";
module.exports = new Proxy({}, {
  get: function (target, name) {
    if (typeof name !== \"string\" || name === \"__esModule\" || name === \"then\") return undefined;
    return function () {
      throw new Error(\"noru: this next/* module is not supported in the browser (\" + name + \")\");
    };
  },
});
";

/// Browser versions of Node.js built-in modules, shipped by the `next` package (same list as Next.js).
const NODE_POLYFILLS: &[(&str, &str)] = &[
    ("assert", "next/dist/compiled/assert"),
    ("buffer", "next/dist/compiled/buffer/"),
    ("constants", "next/dist/compiled/constants-browserify"),
    ("crypto", "next/dist/compiled/crypto-browserify"),
    ("domain", "next/dist/compiled/domain-browser"),
    ("http", "next/dist/compiled/stream-http"),
    ("https", "next/dist/compiled/https-browserify"),
    ("os", "next/dist/compiled/os-browserify"),
    ("path", "next/dist/compiled/path-browserify"),
    ("punycode", "next/dist/compiled/punycode"),
    ("querystring", "next/dist/compiled/querystring-es3"),
    ("stream", "next/dist/compiled/stream-browserify"),
    ("string_decoder", "next/dist/compiled/string_decoder"),
    ("sys", "next/dist/compiled/util/"),
    ("timers", "next/dist/compiled/timers-browserify"),
    ("tty", "next/dist/compiled/tty-browserify"),
    ("util", "next/dist/compiled/util/"),
    ("vm", "next/dist/compiled/vm-browserify"),
    ("zlib", "next/dist/compiled/browserify-zlib"),
    ("events", "next/dist/compiled/events/"),
    ("setImmediate", "next/dist/compiled/setimmediate"),
];

/// `https` / `node:https` -> the browser version shipped by Next.js.
pub fn node_polyfill(specifier: &str) -> Option<&'static str> {
    let name = specifier.strip_prefix("node:").unwrap_or(specifier);
    NODE_POLYFILLS.iter().find(|(module, _)| *module == name).map(|(_, polyfill)| *polyfill)
}

/// Special files of a route segment: (file name without extension, key in the route tree).
const SEGMENT_FILES: &[(&str, &str)] = &[
    ("layout", "layout"),
    ("page", "page"),
    ("loading", "loading"),
    ("error", "error"),
    ("not-found", "notFound"),
    ("template", "template"),
];

const ROUTE_EXTENSIONS: &[&str] = &["tsx", "ts", "jsx", "js"];

/// Returns the `app/` directory of a Next.js App Router project.
pub fn detect(root: &Path) -> Option<PathBuf> {
    if !depends_on_next(root) {
        return None;
    }
    [root.join("app"), root.join("src").join("app")].into_iter().find(|dir| dir.is_dir())
}

/// A Next.js project using the Pages Router only (`pages/`), which noru does not support yet.
pub fn is_pages_router_project(root: &Path) -> bool {
    depends_on_next(root) && (root.join("pages").is_dir() || root.join("src").join("pages").is_dir())
}

/// `next` in package.json, or a `next.config.*` file (noru does not need the `next` package itself).
fn depends_on_next(root: &Path) -> bool {
    if ["next.config.js", "next.config.mjs", "next.config.ts", "next.config.cjs"].iter().any(|f| root.join(f).is_file())
    {
        return true;
    }
    let Ok(text) = std::fs::read_to_string(root.join("package.json")) else { return false };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) else { return false };
    ["dependencies", "devDependencies"].iter().any(|field| json.get(field).and_then(|deps| deps.get("next")).is_some())
}

pub struct NextApp {
    root: PathBuf,
    app_dir: PathBuf,
    virtual_dir: PathBuf,
    files: HashMap<PathBuf, String>,
    page_count: usize,
    notices: Vec<String>,
    /// Dev server: a missing import only breaks the page that uses it (like `next dev`).
    lenient: bool,
}

const MISSING_QUERY: &str = "?noru-missing=";

impl NextApp {
    pub fn load(root: &Path, app_dir: &Path, lenient: bool) -> Self {
        let virtual_dir = normalize_path(&root.join(VIRTUAL_DIR));
        let mut files = HashMap::new();
        for (name, source) in SINGLE_FILE_MODULES {
            files.insert(virtual_dir.join(name), (*source).to_string());
        }
        for (name, source) in split_modules(MISC_MODULES) {
            files.insert(virtual_dir.join(name), source);
        }
        files.insert(virtual_dir.join("unsupported.js"), UNSUPPORTED_MODULE.to_string());
        files.insert(virtual_dir.join("entry.js"), ENTRY.to_string());
        let mut app = Self {
            root: root.to_path_buf(),
            app_dir: app_dir.to_path_buf(),
            virtual_dir,
            files,
            page_count: 0,
            notices: Vec::new(),
            lenient,
        };
        app.refresh();
        app
    }

    /// In the dev server, an import that cannot be resolved becomes a module that throws when it
    /// runs: the page that uses it shows the error, the rest of the app keeps working.
    pub fn missing_module(&self, error: &str, importer: &Path) -> Option<(PathBuf, String, String)> {
        if !self.lenient {
            return None;
        }
        let rel = importer.strip_prefix(&self.root).unwrap_or(importer).to_string_lossy().replace('\\', "/");
        let message = format!("Module not found: {error} (in {rel})");
        let query = format!("{MISSING_QUERY}{}", escape_query(&message));
        Some((self.virtual_dir.join("missing.js"), query, format!("{message}: only the pages that use it will fail")))
    }

    /// Source of a "missing module" (see [`NextApp::missing_module`]).
    pub fn missing_source(&self, path: &Path, query: Option<&str>) -> Option<String> {
        let message = query?.strip_prefix(MISSING_QUERY)?;
        if path != self.virtual_dir.join("missing.js") {
            return None;
        }
        let message = serde_json::to_string(&unescape_query(message)).unwrap_or_default();
        Some(format!("throw new Error({message});\n"))
    }

    /// Scans `app/` again and regenerates the route tree (pages may have been added or removed).
    pub fn refresh(&mut self) {
        let mut report = ScanReport::default();
        let tree = scan(&self.app_dir, String::new(), true, &mut report);
        let icons = find_icons(&self.app_dir);
        let code = generate_routes(&self.root, &tree, report.global_error.as_deref(), &icons);
        self.files.insert(self.virtual_dir.join("routes.js"), code);
        self.page_count = count_pages(&tree);
        self.notices = report.notices(&self.root, &self.app_dir);
    }

    pub fn entry(&self) -> PathBuf {
        self.virtual_dir.join("entry.js")
    }

    pub fn app_dir(&self) -> &Path {
        &self.app_dir
    }

    pub fn page_count(&self) -> usize {
        self.page_count
    }

    /// Things noru ignores in this project (API routes, middleware...), to tell the user once.
    pub fn notices(&self) -> &[String] {
        &self.notices
    }

    /// Source of a generated module.
    pub fn source(&self, path: &Path) -> Option<&str> {
        self.files.get(path).map(String::as_str)
    }

    pub fn is_virtual(&self, path: &Path) -> bool {
        path.starts_with(&self.virtual_dir)
    }

    /// Generated modules resolve their imports as if they were at the project root.
    pub fn virtual_importer(&self) -> PathBuf {
        self.root.join("__noru_next__.js")
    }

    /// `next/*` specifiers -> generated module (and a warning for unsupported ones).
    pub fn resolve(&self, specifier: &str) -> Option<(PathBuf, Option<String>)> {
        let name = specifier.strip_suffix(".js").unwrap_or(specifier);
        if let Some((_, file)) = ALIASES.iter().find(|(alias, _)| *alias == name) {
            return Some((self.virtual_dir.join(file), None));
        }
        if name.starts_with("next/") {
            let warning = format!(
                "\"{specifier}\" is not supported by noru yet (Next.js apps run in the browser): it was replaced by a module that throws when used"
            );
            return Some((self.virtual_dir.join("unsupported.js"), Some(warning)));
        }
        None
    }
}

fn escape_query(text: &str) -> String {
    text.replace('%', "%25").replace('&', "%26").replace('#', "%23").replace('?', "%3F")
}

fn unescape_query(text: &str) -> String {
    text.replace("%3F", "?").replace("%23", "#").replace("%26", "&").replace("%25", "%")
}

fn split_modules(source: &str) -> Vec<(String, String)> {
    let mut modules: Vec<(String, String)> = Vec::new();
    for line in source.lines() {
        if let Some(name) = line.strip_prefix("// @module ") {
            modules.push((name.trim().to_string(), String::new()));
        } else if let Some((_, code)) = modules.last_mut() {
            code.push_str(line);
            code.push('\n');
        }
    }
    modules
}

#[derive(Default)]
struct RouteNode {
    segment: String,
    /// (key in the route tree, file)
    files: Vec<(&'static str, PathBuf)>,
    children: Vec<RouteNode>,
}

#[derive(Default)]
struct ScanReport {
    global_error: Option<PathBuf>,
    route_handlers: Vec<PathBuf>,
    skipped_dirs: Vec<PathBuf>,
}

impl ScanReport {
    fn notices(&self, root: &Path, app_dir: &Path) -> Vec<String> {
        let rel = |p: &Path| p.strip_prefix(root).unwrap_or(p).to_string_lossy().replace('\\', "/");
        let mut notices = Vec::new();
        if !self.route_handlers.is_empty() {
            let names: Vec<String> = self.route_handlers.iter().take(3).map(|p| rel(p)).collect();
            let more = self.route_handlers.len().saturating_sub(3);
            notices.push(format!(
                "{} API route(s) ignored ({}{}): route handlers need a server, which noru does not run yet",
                self.route_handlers.len(),
                names.join(", "),
                if more > 0 { format!(", +{more} more") } else { String::new() }
            ));
        }
        let project_dir = app_dir.parent().unwrap_or(root);
        for name in ["middleware.ts", "middleware.js", "proxy.ts", "proxy.js"] {
            if project_dir.join(name).is_file() || root.join(name).is_file() {
                notices.push(format!("{name} ignored: middleware needs a server, which noru does not run yet"));
            }
        }
        for dir in &self.skipped_dirs {
            notices.push(format!("{} ignored: parallel and intercepting routes are not supported yet", rel(dir)));
        }
        notices
    }
}

fn scan(dir: &Path, segment: String, is_root: bool, report: &mut ScanReport) -> RouteNode {
    let mut node = RouteNode { segment, ..RouteNode::default() };
    let Ok(read) = std::fs::read_dir(dir) else { return node };
    let mut entries: Vec<_> = read.flatten().collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if path.is_dir() {
            // `_folder`: private (not a route). `@slot` / `(.)folder`: parallel / intercepting routes.
            if name.starts_with('_') || name.starts_with('.') || name == "node_modules" {
                continue;
            }
            if name.starts_with('@') || name.starts_with("(.)") || name.starts_with("(..)") || name.starts_with("(...)")
            {
                report.skipped_dirs.push(path);
                continue;
            }
            node.children.push(scan(&path, name, false, report));
            continue;
        }
        let Some((stem, ext)) = name.rsplit_once('.') else { continue };
        if !ROUTE_EXTENSIONS.contains(&ext) {
            continue;
        }
        if let Some((_, key)) = SEGMENT_FILES.iter().find(|(file, _)| *file == stem) {
            if !node.files.iter().any(|(k, _)| k == key) {
                node.files.push((key, path));
            }
        } else if stem == "route" {
            report.route_handlers.push(path);
        } else if stem == "global-error" && is_root {
            report.global_error = Some(path);
        }
    }
    node
}

fn count_pages(node: &RouteNode) -> usize {
    usize::from(node.files.iter().any(|(k, _)| *k == "page")) + node.children.iter().map(count_pages).sum::<usize>()
}

/// `app/favicon.ico`, `app/icon.png`, `app/apple-icon.png`.
fn find_icons(app_dir: &Path) -> Vec<(&'static str, PathBuf)> {
    let mut icons = Vec::new();
    let candidates: [(&str, &str, &[&str]); 3] = [
        ("icon", "favicon", &["ico"]),
        ("icon", "icon", &["ico", "png", "svg", "jpg", "jpeg", "webp"]),
        ("apple-touch-icon", "apple-icon", &["png", "jpg", "jpeg"]),
    ];
    for (rel, stem, exts) in candidates {
        if let Some(path) = exts.iter().map(|ext| app_dir.join(format!("{stem}.{ext}"))).find(|p| p.is_file()) {
            icons.push((rel, path));
        }
    }
    icons
}

/// `require("./app/page.tsx")`, relative to the project root.
fn require_js(root: &Path, path: &Path) -> String {
    let rel = path.strip_prefix(root).unwrap_or(path).to_string_lossy().replace('\\', "/");
    format!("require({})", serde_json::to_string(&format!("./{rel}")).unwrap_or_default())
}

/// Route files are loaded lazily (`function () { return require(...) }`): a page module only runs
/// when the page is visited, so a broken page does not break the others (like Next.js).
fn node_js(root: &Path, node: &RouteNode) -> String {
    let mut fields = vec![format!("s: {}", serde_json::to_string(&node.segment).unwrap_or_default())];
    for (key, path) in &node.files {
        fields.push(format!("{key}: function () {{ return {}; }}", require_js(root, path)));
    }
    let children: Vec<String> = node.children.iter().map(|child| node_js(root, child)).collect();
    fields.push(format!("children: [{}]", children.join(", ")));
    format!("{{ {} }}", fields.join(", "))
}

/// The route tree module (CommonJS, so that `require` can load route files on demand).
fn generate_routes(
    root: &Path,
    tree: &RouteNode,
    global_error: Option<&Path>,
    icons: &[(&'static str, PathBuf)],
) -> String {
    let global_error_js =
        global_error.map_or("null".to_string(), |p| format!("function () {{ return {}; }}", require_js(root, p)));
    let icons_js: Vec<String> =
        icons.iter().map(|(rel, path)| format!("{{ rel: \"{rel}\", href: {} }}", require_js(root, path))).collect();
    format!(
        "exports.tree = {};\nexports.globalError = {global_error_js};\nexports.icons = [{}];\n",
        node_js(root, tree),
        icons_js.join(", ")
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_misc_modules() {
        let modules = split_modules("// header\n// @module a.js\nexport const a = 1;\n// @module b.js\nexport {};\n");
        assert_eq!(
            modules,
            vec![
                ("a.js".to_string(), "export const a = 1;\n".to_string()),
                ("b.js".to_string(), "export {};\n".to_string())
            ]
        );
        let names: Vec<String> = split_modules(MISC_MODULES).into_iter().map(|(n, _)| n).collect();
        for (_, file) in ALIASES {
            assert!(
                names.iter().any(|n| n == file)
                    || SINGLE_FILE_MODULES.iter().any(|(n, _)| n == file)
                    || *file == "routes.js",
                "missing runtime module {file}"
            );
        }
    }

    #[test]
    fn generates_the_route_tree() {
        let root = std::env::temp_dir().join(format!("noru-next-test-{}", std::process::id()));
        let app = root.join("app");
        for dir in ["", "blog/[slug]", "(marketing)/about", "_components", "api/hello", "@modal"] {
            std::fs::create_dir_all(app.join(dir)).unwrap();
        }
        std::fs::write(root.join("package.json"), r#"{"dependencies":{"next":"16.0.0"}}"#).unwrap();
        for file in [
            "layout.tsx",
            "page.tsx",
            "not-found.tsx",
            "global-error.tsx",
            "blog/[slug]/page.tsx",
            "blog/[slug]/loading.tsx",
            "(marketing)/about/page.tsx",
            "_components/page.tsx",
            "api/hello/route.ts",
            "favicon.ico",
        ] {
            std::fs::write(app.join(file), "export default function X() {}").unwrap();
        }

        assert_eq!(detect(&root), Some(app.clone()));
        let next = NextApp::load(&root, &app, true);
        let (path, query, _) = next.missing_module("cannot resolve \"./x?a&b\"", &app.join("page.tsx")).unwrap();
        let source = next.missing_source(&path, Some(&query)).unwrap();
        assert_eq!(
            source,
            "throw new Error(\"Module not found: cannot resolve \\\"./x?a&b\\\" (in app/page.tsx)\");\n"
        );
        assert!(NextApp::load(&root, &app, false).missing_module("x", &app).is_none());
        let routes = next.source(&next.virtual_dir.join("routes.js")).unwrap();
        assert!(routes.contains("layout: function () { return require(\"./app/layout.tsx\"); }"), "{routes}");
        assert!(
            routes
                .contains("s: \"[slug]\", loading: function () { return require(\"./app/blog/[slug]/loading.tsx\"); }"),
            "{routes}"
        );
        assert!(routes.contains("s: \"(marketing)\""), "{routes}");
        assert!(!routes.contains("_components"), "{routes}");
        assert!(routes.contains("exports.globalError = function () { return require(\"./app/global-error.tsx\"); }"));
        assert!(routes.contains("{ rel: \"icon\", href: require(\"./app/favicon.ico\") }"), "{routes}");
        assert_eq!(next.page_count(), 3);
        assert!(next.notices().iter().any(|n| n.contains("API route")), "{:?}", next.notices());
        assert!(next.notices().iter().any(|n| n.contains("@modal")), "{:?}", next.notices());

        assert_eq!(next.resolve("next/link").unwrap().0, next.virtual_dir.join("link.js"));
        assert_eq!(next.resolve("next/navigation.js").unwrap().0, next.virtual_dir.join("navigation.js"));
        assert!(next.resolve("next/amp").unwrap().1.is_some());
        assert!(next.resolve("react").is_none());
        std::fs::remove_dir_all(&root).unwrap();
    }
}
