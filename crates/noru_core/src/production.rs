//! Production extras: precompressed files (Brotli + gzip), page weights and budget, the service
//! worker (offline, instant repeat visits) and the bundle report.

use std::io::Write;

/// Files worth compressing (text formats).
pub fn is_compressible(file_name: &str) -> bool {
    let ext = file_name.rsplit_once('.').map_or("", |(_, e)| e).to_ascii_lowercase();
    matches!(
        ext.as_str(),
        "js" | "mjs" | "css" | "html" | "svg" | "json" | "txt" | "xml" | "map" | "webmanifest" | "wasm" | "ico"
    )
}

/// Brotli at a high quality: done once at build time, served as-is (`.br` files). Quality 11 is
/// 3 to 10 times slower than 10 for 1-2 % smaller files: only used for small files.
pub fn brotli(bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    let quality = if bytes.len() < 20_000 { 11 } else { 10 };
    let params = brotli::enc::BrotliEncoderParams { quality, lgwin: 22, ..Default::default() };
    let _ = brotli::BrotliCompress(&mut &bytes[..], &mut out, &params);
    out
}

/// Gzip at the highest level (`.gz` files, for clients without Brotli).
pub fn gzip_best(bytes: &[u8]) -> Vec<u8> {
    let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::best());
    if encoder.write_all(bytes).is_err() {
        return Vec::new();
    }
    encoder.finish().unwrap_or_default()
}

/// How heavy a page is for a first visit: the JS and CSS it needs, compressed with Brotli.
#[derive(Debug, Clone)]
pub struct PageWeight {
    /// Route (`/`, `/blog/[slug]`...).
    pub route: String,
    pub files: Vec<String>,
    /// Bytes downloaded (Brotli).
    pub bytes: usize,
}

impl PageWeight {
    /// Estimated download time on a slow 3G connection (400 kbit/s, 400 ms round trip).
    pub fn slow_3g_ms(&self) -> u64 {
        estimate_ms(self.bytes, 400_000.0, 400.0)
    }

    /// Estimated download time on 4G (9 Mbit/s, 50 ms round trip).
    pub fn fast_4g_ms(&self) -> u64 {
        estimate_ms(self.bytes, 9_000_000.0, 50.0)
    }
}

fn estimate_ms(bytes: usize, bits_per_second: f64, round_trip_ms: f64) -> u64 {
    // Connection + request, then the transfer (files load in parallel on HTTP/2).
    (2.0 * round_trip_ms + bytes as f64 * 8.0 / bits_per_second * 1000.0) as u64
}

/// `export const NORU_VERSION` of the service worker: changes when any file changes.
pub fn service_worker(version: &str, base: &str, core: &[String], other: &[String]) -> String {
    let list = |files: &[String]| {
        serde_json::to_string(&files.iter().map(|f| format!("{base}{f}")).collect::<Vec<_>>()).unwrap_or_default()
    };
    SERVICE_WORKER
        .replace("__VERSION__", &serde_json::to_string(version).unwrap_or_default())
        .replace("__BASE__", &serde_json::to_string(base).unwrap_or_default())
        .replace("__CORE__", &list(core))
        .replace("__OTHER__", &list(other))
}

/// Registers the service worker; on a good connection, asks it to download the rest of the app
/// in the background (pages open instantly later, even offline).
pub fn service_worker_registration(base: &str) -> String {
    let url = serde_json::to_string(&format!("{base}sw.js")).unwrap_or_default();
    let scope = serde_json::to_string(base).unwrap_or_default();
    format!(
        "    <script>if(\"serviceWorker\"in navigator)addEventListener(\"load\",function(){{navigator.serviceWorker.register({url},{{scope:{scope}}}).then(function(){{var c=navigator.connection;if(c&&(c.saveData||/2g/.test(c.effectiveType||\"\")))return;navigator.serviceWorker.ready.then(function(r){{r.active&&r.active.postMessage({{type:\"noru:warm\"}})}})}}).catch(function(){{}})}})</script>\n"
    )
}

/// Served by the dev server at `/sw.js`: removes a service worker left by a production build on
/// the same address, so that it never serves stale files during development.
pub const DEV_SERVICE_WORKER: &str = "self.addEventListener(\"install\", function () { self.skipWaiting(); });
self.addEventListener(\"activate\", function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) { return Promise.all(keys.filter(function (k) { return k.indexOf(\"noru-\") === 0; }).map(function (k) { return caches.delete(k); })); })
      .then(function () { return self.registration.unregister(); })
      .then(function () { return self.clients.matchAll(); })
      .then(function (clients) { clients.forEach(function (client) { client.navigate(client.url); }); })
  );
});
";

const SERVICE_WORKER: &str = r#"// noru service worker: repeat visits open instantly, and the app works offline.
var VERSION = __VERSION__;
var BASE = __BASE__;
// Cached at install: the page shell, the entry JavaScript and the CSS.
var CORE = __CORE__;
// The other chunks: cached when used, or in the background on a good connection.
var OTHER = __OTHER__;
var CACHE = "noru-" + VERSION;
var SHELL = BASE + "shell.html";

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) { return cache.addAll(CORE); }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k.indexOf("noru-") === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

function store(request, response) {
  if (response && response.ok && !response.redirected && response.type === "basic") {
    var copy = response.clone();
    caches.open(CACHE).then(function (cache) { cache.put(request, copy); });
  }
  return response;
}

function withTimeout(promise, ms) {
  return new Promise(function (resolve, reject) {
    var timer = setTimeout(function () { reject(new Error("timeout")); }, ms);
    promise.then(function (value) { clearTimeout(timer); resolve(value); }, function (error) { clearTimeout(timer); reject(error); });
  });
}

self.addEventListener("fetch", function (event) {
  var request = event.request;
  if (request.method !== "GET") return;
  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf(BASE + "api/") === 0 || url.pathname.indexOf("/@noru/") === 0) return;

  // Files with a content hash never change: from the cache, else from the network (then cached).
  if (url.pathname.indexOf(BASE + "assets/") === 0 && /-[0-9a-f]{8}\.[a-z0-9]+$/.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then(function (hit) {
        return hit || fetch(request).then(function (response) { return store(request, response); });
      })
    );
    return;
  }

  // Pages: the network first (fresh content); the cached copy when offline or when the network
  // takes more than 4 s; the app shell for a page never visited.
  if (request.mode === "navigate") {
    var network = fetch(request).then(function (response) { return store(request, response); });
    event.respondWith(
      withTimeout(network, 4000).catch(function () {
        return caches.match(request).then(function (hit) {
          return hit || caches.match(SHELL).then(function (shell) { return shell || network; });
        });
      })
    );
  }
});

// Sent by the page on a good connection: download the rest of the app in the background.
self.addEventListener("message", function (event) {
  if (!event.data || event.data.type !== "noru:warm") return;
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return Promise.all(OTHER.map(function (url) {
        return cache.match(url).then(function (hit) { return hit || cache.add(url).catch(function () {}); });
      }));
    })
  );
});
"#;

/// A module of the bundle, for the report.
pub struct ReportModule {
    pub name: String,
    pub file: String,
    pub bytes: usize,
}

/// `noru-report.html`: page weights and what each file is made of.
pub fn report_html(pages: &[PageWeight], modules: &[ReportModule], budget_kb: Option<f64>) -> String {
    let escape = |s: &str| s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;");
    let kb = |b: usize| format!("{:.1} kB", b as f64 / 1000.0);
    let max_page = pages.iter().map(|p| p.bytes).max().unwrap_or(1).max(1);
    let mut page_rows = String::new();
    for page in pages {
        let over = budget_kb.is_some_and(|b| page.bytes as f64 / 1000.0 > b);
        page_rows.push_str(&format!(
            "<tr class=\"{}\"><td><code>{}</code></td><td class=\"num\">{}</td><td><div class=\"bar\" style=\"width:{:.1}%\"></div></td><td class=\"num\">{:.1} s</td><td class=\"num\">{:.2} s</td></tr>\n",
            if over { "over" } else { "" },
            escape(&page.route),
            kb(page.bytes),
            page.bytes as f64 * 100.0 / max_page as f64,
            page.slow_3g_ms() as f64 / 1000.0,
            page.fast_4g_ms() as f64 / 1000.0,
        ));
    }
    // Group modules by npm package (or "your code") and by file.
    let mut groups: std::collections::BTreeMap<String, (usize, Vec<&ReportModule>)> = Default::default();
    for module in modules {
        let group = match package_of(&module.name) {
            Some(name) if name == ".noru-next" => "noru runtime (next/*)".to_string(),
            Some(name) => name,
            None => "your code".to_string(),
        };
        let entry = groups.entry(group).or_default();
        entry.0 += module.bytes;
        entry.1.push(module);
    }
    let mut groups: Vec<_> = groups.into_iter().collect();
    groups.sort_by_key(|(_, (bytes, _))| std::cmp::Reverse(*bytes));
    let total: usize = modules.iter().map(|m| m.bytes).sum::<usize>().max(1);
    let mut group_rows = String::new();
    for (name, (bytes, mut list)) in groups {
        list.sort_by_key(|m| std::cmp::Reverse(m.bytes));
        let details: String = list
            .iter()
            .take(40)
            .map(|m| {
                format!(
                    "<li><span class=\"num\">{}</span> <code>{}</code> <span class=\"file\">{}</span></li>",
                    kb(m.bytes),
                    escape(&m.name),
                    escape(&m.file)
                )
            })
            .collect();
        group_rows.push_str(&format!(
            "<details><summary><span class=\"name\">{}</span><span class=\"num\">{} · {:.1}%</span><div class=\"bar\" style=\"width:{:.1}%\"></div></summary><ul>{details}</ul></details>\n",
            escape(&name),
            kb(bytes),
            bytes as f64 * 100.0 / total as f64,
            bytes as f64 * 100.0 / total as f64,
        ));
    }
    REPORT
        .replace("__BUDGET__", &budget_kb.map_or("none".to_string(), |b| format!("{b} kB per page")))
        .replace("__PAGES__", &page_rows)
        .replace("__MODULES__", &group_rows)
}

/// `node_modules/@scope/name/...` -> `@scope/name`.
fn package_of(path: &str) -> Option<String> {
    let rest = &path[path.rfind("node_modules/")? + "node_modules/".len()..];
    let mut parts = rest.split('/');
    let first = parts.next()?;
    Some(if first.starts_with('@') { format!("{first}/{}", parts.next().unwrap_or("")) } else { first.to_string() })
}

const REPORT: &str = r#"<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>noru build report</title>
<style>
:root { --bg:#0B0F14; --surface:#121821; --border:#243041; --text:#E8EDF2; --muted:#8A96A6; --accent:#FF6B2C; --bad:#FF4D4F; }
@media (prefers-color-scheme: light) { :root { --bg:#F7F8FA; --surface:#fff; --border:#DDE2E8; --text:#0E141B; --muted:#5B6675; } }
body { margin:0; padding:24px 16px; background:var(--bg); color:var(--text); font:14px/1.5 system-ui, sans-serif; }
main { max-width:1100px; margin:0 auto; }
h1 { font-size:22px; } h2 { font-size:17px; margin-top:32px; }
.muted { color:var(--muted); }
table { width:100%; border-collapse:collapse; background:var(--surface); border:1px solid var(--border); border-radius:10px; overflow:hidden; }
th, td { padding:8px 10px; border-bottom:1px solid var(--border); text-align:left; vertical-align:middle; }
th { color:var(--muted); font-weight:600; font-size:12px; text-transform:uppercase; }
.num { text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums; }
.bar { height:8px; border-radius:4px; background:var(--accent); min-width:2px; }
tr.over td { color:var(--bad); } tr.over .bar { background:var(--bad); }
details { background:var(--surface); border:1px solid var(--border); border-radius:10px; margin:8px 0; padding:8px 12px; }
summary { cursor:pointer; display:grid; grid-template-columns: 1fr auto; gap:4px 12px; align-items:center; }
summary .bar { grid-column: 1 / -1; }
ul { list-style:none; padding:0; margin:8px 0 0; } li { padding:2px 0; } .file { color:var(--muted); font-size:12px; }
code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size:12.5px; }
</style>
</head>
<body><main>
<h1>noru build report</h1>
<p class="muted">JavaScript and CSS each page downloads on a first visit (Brotli). Budget: __BUDGET__. Times are estimates (slow 3G: 400 kbit/s, 400 ms latency · 4G: 9 Mbit/s, 50 ms).</p>
<h2>Pages</h2>
<table><thead><tr><th>Route</th><th class="num">Size</th><th style="width:35%"></th><th class="num">Slow 3G</th><th class="num">4G</th></tr></thead><tbody>
__PAGES__
</tbody></table>
<h2>What the JavaScript is made of</h2>
<p class="muted">Source size before minification and compression, grouped by npm package. Click a line for its biggest files.</p>
__MODULES__
</main></body>
</html>
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compresses_and_estimates() {
        let text = "hello noru ".repeat(500);
        assert!(brotli(text.as_bytes()).len() < gzip_best(text.as_bytes()).len());
        assert!(is_compressible("assets/index-abc.js") && !is_compressible("logo.png"));
        let page = PageWeight { route: "/".into(), files: vec![], bytes: 50_000 };
        assert_eq!(page.slow_3g_ms(), 1800);
        assert_eq!(package_of("node_modules/@mui/material/Button.js").as_deref(), Some("@mui/material"));
        assert_eq!(package_of("src/app/page.tsx"), None);
        let sw = service_worker("v1", "/", &["index.html".into()], &["assets/a.js".into()]);
        assert!(sw.contains("var CORE = [\"/index.html\"];") && sw.contains("var OTHER = [\"/assets/a.js\"];"));
    }
}
