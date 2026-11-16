//! `noru build`: index.html -> module graph -> bundles -> dist/.

use std::fmt;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use std::collections::HashMap;

use crate::bundle::{
    generate_css, generate_dev_js, generate_js, generate_server_js, generate_split_js, render_modules, ChunkFile,
    RenderedModule,
};
use crate::env::{load_env, Defines};
use crate::graph::Graph;
use crate::graph::{build_graph, Context, ModuleCache};
use crate::html::{find_entries, rewrite_html, url_to_path, HtmlEntries};
use crate::module::{content_hash, EmittedFile, ModuleKey};
use crate::next::server::ServerTarget;
use crate::next::NextApp;
use crate::options::BuildOptions;
use crate::pkg::PackageCache;
use crate::postcss::PostCss;
use crate::production::{PageWeight, ReportModule};
use crate::resolve::NoruResolver;
use crate::treeshake::shake;

#[derive(Debug, Clone)]
pub struct OutputFile {
    /// Path relative to the output directory, with forward slashes.
    pub file_name: String,
    pub size: usize,
    pub gzip_size: usize,
    /// Size once compressed with Brotli (what browsers download); 0 for files not compressed.
    pub brotli_size: usize,
}

#[derive(Debug, Clone)]
pub struct BuildResult {
    pub out_dir: PathBuf,
    pub files: Vec<OutputFile>,
    pub warnings: Vec<String>,
    pub module_count: usize,
    /// Modules left out of the bundle by tree-shaking.
    pub removed_modules: usize,
    /// What each page downloads on a first visit (JS + CSS, Brotli).
    pub pages: Vec<PageWeight>,
    /// `noru-report.html`, when asked for.
    pub report: Option<PathBuf>,
    pub duration: Duration,
}

#[derive(Debug, Clone)]
pub struct BuildError {
    pub messages: Vec<String>,
}

impl BuildError {
    pub(crate) fn one(message: impl Into<String>) -> Self {
        Self { messages: vec![message.into()] }
    }
}

impl fmt::Display for BuildError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.messages.join("\n\n"))
    }
}

impl std::error::Error for BuildError {}

/// Everything known about a project before bundling: paths, index.html entries, resolver...
pub(crate) struct Project {
    pub root: PathBuf,
    pub out_dir: PathBuf,
    pub public_dir: PathBuf,
    pub base: String,
    pub minify: bool,
    pub treeshake: bool,
    /// Production: split the JavaScript at `import()` points.
    pub split: bool,
    pub html: String,
    pub entries: HtmlEntries,
    /// Project kind, shown when the dev server starts (e.g. "Next.js app, 12 pages").
    pub summary: Option<String>,
    /// Things noru ignores in this project, to tell the user once.
    pub notices: Vec<String>,
    entry_keys: Vec<ModuleKey>,
    style_count: usize,
    ctx: Context,
    /// Next.js middleware and route handlers, bundled for Node.js.
    server_ctx: Option<Context>,
}

/// The result of bundling, in memory.
pub(crate) struct Bundle {
    pub js: String,
    /// Split builds: the chunks loaded on demand.
    pub chunks: Vec<ChunkFile>,
    /// Each page (route) and the chunks it needs on top of the entry file.
    pub pages: Vec<(String, Vec<String>)>,
    /// Size of each module, and its chunk ("" for the entry file), for the report.
    pub module_sizes: Vec<ReportModule>,
    pub css: String,
    pub assets: Vec<EmittedFile>,
    pub warnings: Vec<String>,
    pub module_count: usize,
    pub removed_count: usize,
}

/// Module ids that stay the same across dev rebuilds, so hot updates can target them.
#[derive(Default)]
pub(crate) struct StableIds {
    map: HashMap<ModuleKey, usize>,
    next: usize,
}

impl StableIds {
    fn get(&mut self, key: &ModuleKey) -> usize {
        if let Some(&id) = self.map.get(key) {
            return id;
        }
        let id = self.next;
        self.next += 1;
        self.map.insert(key.clone(), id);
        id
    }
}

/// The result of a development build, in memory.
pub(crate) struct DevBundle {
    pub modules: Vec<RenderedModule>,
    pub js: String,
    pub css: String,
    pub assets: Vec<EmittedFile>,
    pub warnings: Vec<String>,
    pub module_count: usize,
    pub processed_count: usize,
}

impl Project {
    /// The server bundle (Next.js middleware + route handlers), or `None` if the app has none.
    pub fn bundle_server(&self, cache: Option<&mut ModuleCache>) -> Result<Option<String>, BuildError> {
        let Some(ctx) = &self.server_ctx else { return Ok(None) };
        let Some(server) = &ctx.server else { return Ok(None) };
        let entry = [ModuleKey::new(server.entry.clone(), None)];
        let graph = build_graph(&entry, ctx, cache).map_err(|messages| BuildError { messages })?;
        Ok(Some(generate_server_js(&graph, &self.root)))
    }

    /// The bundle `noru build` runs with Node.js to render the pages to HTML: the app and
    /// react-dom/server, in one file.
    pub fn bundle_prerender(&self, cache: &mut ModuleCache) -> Result<String, BuildError> {
        let Some(next) = &self.ctx.next else { return Err(BuildError::one("not a Next.js app")) };
        let entry = [ModuleKey::new(next.prerender_entry(), None)];
        let graph = build_graph(&entry, &self.ctx, Some(cache)).map_err(|messages| BuildError { messages })?;
        let shaken = shake(&graph, &[0], self.treeshake);
        generate_js(&graph, &[0], &self.root, false, &shaken).map_err(BuildError::one)
    }

    /// Development bundle: no tree-shaking, stable ids, HMR runtime and React Fast Refresh.
    pub fn bundle_dev(&self, cache: &mut ModuleCache, ids: &mut StableIds) -> Result<DevBundle, BuildError> {
        let graph =
            build_graph(&self.entry_keys, &self.ctx, Some(cache)).map_err(|messages| BuildError { messages })?;
        let all_entries: Vec<usize> = (0..self.entry_keys.len()).collect();
        let shaken = shake(&graph, &all_entries, false);
        let id_of: Vec<usize> = graph.modules.iter().map(|m| ids.get(&m.key)).collect();
        let modules = render_modules(&graph, &self.root, &shaken, &|i| Some(id_of[i]), true);
        let entries: Vec<usize> = all_entries[self.style_count..].iter().map(|&e| id_of[e]).collect();
        let js = generate_dev_js(&modules, &entries);
        let css = generate_css(&graph, &all_entries, self.minify, &shaken.included);
        Ok(DevBundle {
            modules,
            js,
            css,
            assets: graph.emitted(&shaken.included),
            module_count: graph.modules.len(),
            processed_count: graph.processed_count,
            warnings: graph.warnings,
        })
    }

    pub fn load(options: &BuildOptions) -> Result<Self, BuildError> {
        let root = options.resolved_root();
        let out_dir = options.resolved_out_dir(&root);
        let public_dir = options.resolved_public_dir(&root);
        let base = options.normalized_base();

        let html_path = root.join("index.html");
        let next_app_dir = if html_path.is_file() { None } else { crate::next::detect(&root) };
        let mut next = None;
        let mut entry_keys = Vec::new();
        let (html, entries) = if let Some(app_dir) = next_app_dir {
            // Next.js App Router project: the page and the entry module are generated.
            let app = NextApp::load(&root, &app_dir, options.hmr, options.split && !options.hmr);
            entry_keys.push(ModuleKey::new(app.entry(), None));
            let html = app.html();
            next = Some(app);
            (html, HtmlEntries { scripts: vec![], styles: vec![] })
        } else {
            let html = std::fs::read_to_string(&html_path).map_err(|_| {
                if crate::next::is_pages_router_project(&root) {
                    BuildError::one(
                        "this Next.js project uses the Pages Router (pages/), which noru does not support yet: noru runs Next.js App Router projects (app/)",
                    )
                } else {
                    BuildError::one(format!(
                        "no index.html found in {} (noru builds Vite-style apps with an index.html, and Next.js App Router apps)",
                        root.display()
                    ))
                }
            })?;
            let entries = find_entries(&html, &root, &public_dir);
            if entries.scripts.is_empty() {
                return Err(BuildError::one(
                    "index.html has no <script type=\"module\" src=\"...\"> entry (e.g. <script type=\"module\" src=\"/src/main.tsx\"></script>)",
                ));
            }
            for url in entries.styles.iter().chain(entries.scripts.iter()) {
                let path = url_to_path(&root, url);
                if !path.is_file() {
                    return Err(BuildError::one(format!(
                        "entry \"{url}\" referenced in index.html does not exist ({})",
                        path.display()
                    )));
                }
                entry_keys.push(ModuleKey::new(path, None));
            }
            (html, entries)
        };

        let summary = next.as_ref().map(|app| {
            let dir = app.app_dir().strip_prefix(&root).unwrap_or(app.app_dir()).to_string_lossy().replace('\\', "/");
            let mut server = Vec::new();
            if app.has_middleware() {
                server.push("middleware".to_string());
            }
            if app.route_handler_count() > 0 {
                server.push(format!("{} API route(s)", app.route_handler_count()));
            }
            let server =
                if server.is_empty() { String::new() } else { format!(" + {} on Node.js", server.join(" and ")) };
            format!("Next.js app ({dir}/, {} pages){server}", app.page_count())
        });
        let notices = next.as_ref().map(|app| app.notices().to_vec()).unwrap_or_default();
        // Middleware and route handlers: bundled for Node.js with their own context.
        let server_ctx = next.as_ref().and_then(|app| {
            let source = app.server_entry_source()?;
            Some(Context {
                base: base.clone(),
                public_dir: public_dir.clone(),
                minify: false,
                inline_limit: options.asset_inline_limit,
                defines: Defines::build(&options.mode, &base, &Default::default(), false),
                resolver: NoruResolver::new(&root, options.mode == "production"),
                jsx_import_source: "react".to_string(),
                packages: PackageCache::default(),
                react_refresh: false,
                next: None,
                postcss: None,
                server: Some(ServerTarget::new(&root, app.virtual_dir(), source)),
                images: None,
                fonts: None,
            })
        });
        let env = load_env(&root, &options.mode);
        let ctx = Context {
            base: base.clone(),
            public_dir: public_dir.clone(),
            minify: options.minify,
            inline_limit: options.asset_inline_limit,
            defines: Defines::build(&options.mode, &base, &env, next.is_some()),
            resolver: NoruResolver::new(&root, options.mode == "production"),
            jsx_import_source: if next.is_some() { crate::next::JSX_IMPORT_SOURCE } else { "react" }.to_string(),
            packages: PackageCache::default(),
            react_refresh: options.hmr,
            images: if next.is_some() && !options.hmr { crate::images::ImageOptimizer::detect(&root) } else { None },
            fonts: (next.is_some() && !options.hmr).then(crate::fonts::GoogleFonts::default),
            next,
            postcss: PostCss::detect(&root),
            server: None,
        };

        Ok(Self {
            style_count: entries.styles.len(),
            root,
            out_dir,
            public_dir,
            base,
            minify: options.minify,
            treeshake: options.treeshake,
            split: options.split && !options.hmr,
            html,
            entries,
            summary,
            notices,
            entry_keys,
            ctx,
            server_ctx,
        })
    }

    /// Next.js projects: picks up added / removed pages and route handlers before a rebuild.
    /// Returns true when the project must be loaded again (a middleware appeared or disappeared...).
    pub fn refresh_routes(&mut self) -> bool {
        let Some(next) = self.ctx.next.as_mut() else { return false };
        let had_middleware = next.has_middleware();
        next.refresh();
        let source = next.server_entry_source();
        if next.has_middleware() != had_middleware {
            return true;
        }
        match (source, self.server_ctx.as_mut().and_then(|ctx| ctx.server.as_mut())) {
            (Some(source), Some(server)) => {
                server.entry_source = source;
                false
            }
            (None, None) => false,
            _ => true,
        }
    }

    /// CSS files whose output depends on the other source files (Tailwind scans them for classes).
    pub fn postcss_outputs(&self) -> Vec<PathBuf> {
        self.ctx.postcss.as_ref().map(PostCss::processed_files).unwrap_or_default()
    }

    pub fn bundle(&self, cache: Option<&mut ModuleCache>) -> Result<Bundle, BuildError> {
        let graph = build_graph(&self.entry_keys, &self.ctx, cache).map_err(|messages| BuildError { messages })?;
        let all_entries: Vec<usize> = (0..self.entry_keys.len()).collect();
        let js_entries = &all_entries[self.style_count..];
        let shaken = shake(&graph, &all_entries, self.treeshake);
        let (js, chunks, pages, module_sizes) = if self.split {
            let split = generate_split_js(&graph, js_entries, &self.root, self.minify, &shaken, &self.base)
                .map_err(BuildError::one)?;
            let pages = self.page_chunks(&graph, &split.root_chunks, &split.chunks);
            let sizes = split
                .sizes
                .iter()
                .map(|&(id, bytes)| ReportModule {
                    name: graph.modules[id].key.display(&self.root),
                    file: split.module_chunk[id].map_or(String::new(), |c| split.chunks[c].file_name.clone()),
                    bytes,
                })
                .collect();
            (split.main, split.chunks, pages, sizes)
        } else {
            let js = generate_js(&graph, js_entries, &self.root, self.minify, &shaken).map_err(BuildError::one)?;
            let pages = self.page_chunks(&graph, &HashMap::new(), &[]);
            (js, Vec::new(), pages, Vec::new())
        };
        let css = generate_css(&graph, &all_entries, self.minify, &shaken.included);
        Ok(Bundle {
            js,
            chunks,
            pages,
            module_sizes,
            css,
            assets: graph.emitted(&shaken.included),
            removed_count: shaken.removed_count(),
            module_count: graph.modules.len(),
            warnings: graph.warnings,
        })
    }
}

impl Project {
    /// The pages of a Next.js app and the chunks each one loads (the chunks of its page, layouts,
    /// templates...). A plain React app has one page, `/`.
    fn page_chunks(
        &self,
        graph: &Graph,
        root_chunks: &HashMap<usize, Vec<usize>>,
        chunks: &[ChunkFile],
    ) -> Vec<(String, Vec<String>)> {
        let Some(next) = &self.ctx.next else { return vec![("/".to_string(), Vec::new())] };
        let canonical = |p: &Path| std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
        let mut ids: HashMap<PathBuf, usize> = HashMap::new();
        for (id, module) in graph.modules.iter().enumerate() {
            if module.key.query.is_none() && module.key.path.starts_with(&self.root) {
                let path = &module.key.path;
                if !path.components().any(|c| c.as_os_str() == "node_modules") {
                    ids.insert(path.clone(), id);
                    ids.entry(canonical(path)).or_insert(id);
                }
            }
        }
        next.pages()
            .iter()
            .map(|(route, files)| {
                let mut list: Vec<usize> = Vec::new();
                for file in files {
                    let id = ids.get(file).or_else(|| ids.get(&canonical(file)));
                    for &chunk in id.and_then(|id| root_chunks.get(id)).into_iter().flatten() {
                        if !list.contains(&chunk) {
                            list.push(chunk);
                        }
                    }
                }
                (route.clone(), list.into_iter().map(|c| chunks[c].file_name.clone()).collect())
            })
            .collect()
    }
}

pub fn build(options: &BuildOptions) -> Result<BuildResult, BuildError> {
    let start = Instant::now();
    let project = Project::load(options)?;
    // NORU_PROFILE=1: time spent in each step.
    let profiling = std::env::var_os("NORU_PROFILE").is_some();
    let mut last = Instant::now();
    let mut profile = |step: &str| {
        if profiling {
            eprintln!("[noru profile] {step}: {} ms", last.elapsed().as_millis());
            last = Instant::now();
        }
    };
    let mut cache = ModuleCache::default();
    let mut bundle = project.bundle(Some(&mut cache))?;
    let server = project.bundle_server(None)?;
    let base = &project.base;
    let mut warnings = project.notices.clone();
    warnings.extend(bundle.warnings.iter().cloned());

    profile("bundle");
    // next/font/google: the fonts are downloaded now and served with the app.
    let mut font_tags = String::new();
    let mut font_files = Vec::new();
    if let Some(fonts) = &project.ctx.fonts {
        match fonts.self_host(&project.root, base) {
            Ok(Some(hosted)) => {
                let css = if options.minify { compact_font_css(&hosted.css) } else { hosted.css.clone() };
                bundle.css = format!("{css}{}", bundle.css);
                let urls: serde_json::Map<String, serde_json::Value> =
                    hosted.urls.iter().map(|u| (u.clone(), serde_json::Value::Bool(true))).collect();
                font_tags.push_str(&format!(
                    "    <script>window.__NORU_FONTS__ = {}</script>\n",
                    serde_json::Value::Object(urls).to_string().replace("</", "<\\/")
                ));
                for file in &hosted.preload {
                    font_tags.push_str(&format!(
                        "    <link rel=\"preload\" href=\"{base}{file}\" as=\"font\" type=\"font/woff2\" crossorigin>\n"
                    ));
                }
                font_files = hosted.files;
            }
            Ok(None) => {}
            Err(error) => warnings.push(format!("{error} — the browser will load them from Google Fonts")),
        }
    }

    let js_name = format!("assets/index-{}.js", content_hash(bundle.js.as_bytes()));
    let css_name =
        (!bundle.css.is_empty()).then(|| format!("assets/index-{}.css", content_hash(bundle.css.as_bytes())));
    let mut tags = font_tags;
    if project.ctx.next.is_some() && bundle.pages.iter().any(|(_, chunks)| !chunks.is_empty()) {
        // Starts downloading the chunks of the requested page with the entry file (no waterfall).
        tags.push_str(&preload_script(base, &bundle.pages));
    }
    tags.push_str(&format!("    <script type=\"module\" crossorigin src=\"{base}{js_name}\"></script>\n"));
    if let Some(css_name) = &css_name {
        tags.push_str(&format!("    <link rel=\"stylesheet\" crossorigin href=\"{base}{css_name}\">\n"));
    }
    // Offline mode and instant repeat visits: a service worker (unless the app has its own).
    let own_worker = project.public_dir.join("sw.js").exists();
    let offline = options.offline && base.starts_with('/') && !own_worker;
    if options.offline && own_worker {
        warnings.push("public/sw.js exists: noru keeps your service worker and does not generate one".to_string());
    }
    if offline {
        tags.push_str(&crate::production::service_worker_registration(base));
    }
    let html_out = rewrite_html(&project.html, &project.entries, &tags, base);

    // Write everything.
    let out_dir = &project.out_dir;
    prepare_out_dir(out_dir, &project.root, options.empty_out_dir).map_err(BuildError::one)?;
    if project.public_dir.is_dir() && !out_dir.starts_with(&project.public_dir) {
        copy_dir(&project.public_dir, out_dir).map_err(|e| BuildError::one(format!("cannot copy public dir: {e}")))?;
    }

    profile("fonts + images");
    // Next.js: static pages rendered to HTML (their content shows before the JavaScript loads).
    let mut prerendered = Vec::new();
    if options.prerender && project.ctx.next.is_some() {
        let routes: Vec<String> =
            bundle.pages.iter().map(|(route, _)| route.clone()).filter(|route| !route.contains('[')).collect();
        if !routes.is_empty() {
            let code = project.bundle_prerender(&mut cache)?;
            match crate::next::prerender::render(&project.root, &code, &routes) {
                Ok((pages, skipped)) => {
                    if !skipped.is_empty() {
                        let list: Vec<String> =
                            skipped.iter().map(|(route, why)| format!("  {route}: {why}")).collect();
                        warnings.push(format!(
                            "{} page(s) not pre-rendered (they render in the browser as usual):\n{}",
                            skipped.len(),
                            list.join("\n")
                        ));
                    }
                    prerendered = pages;
                }
                Err(error) => warnings.push(format!("pages not pre-rendered: {error}")),
            }
        }
    }

    profile("pre-render");
    let mut files: Vec<EmittedFile> = Vec::new();
    if offline || !prerendered.is_empty() {
        // The empty app shell: served for pages without their own HTML file (and offline).
        files.push(EmittedFile { file_name: "shell.html".into(), contents: html_out.clone().into_bytes() });
    }
    for page in &prerendered {
        let html = crate::next::prerender::page_html(&html_out, page);
        files.push(EmittedFile {
            file_name: crate::next::prerender::file_name(&page.route),
            contents: html.into_bytes(),
        });
    }
    if !prerendered.iter().any(|p| p.route == "/") {
        files.push(EmittedFile { file_name: "index.html".into(), contents: html_out.into_bytes() });
    }
    files.extend(bundle.assets);
    files.extend(font_files);
    if let Some(images) = &project.ctx.images {
        // AVIF / WebP versions of the images, encoded by sharp while the app was bundled.
        let (encoded, image_warnings) = images.finish();
        files.extend(encoded);
        warnings.extend(image_warnings);
    }
    if let Some(name) = &css_name {
        files.push(EmittedFile { file_name: name.clone(), contents: bundle.css.into_bytes() });
    }
    files.push(EmittedFile { file_name: js_name.clone(), contents: bundle.js.into_bytes() });
    for chunk in bundle.chunks {
        files.push(EmittedFile { file_name: chunk.file_name, contents: chunk.code.into_bytes() });
    }
    if offline {
        let core: Vec<String> =
            ["shell.html".to_string(), js_name.clone()].into_iter().chain(css_name.clone()).collect();
        let other: Vec<String> = files
            .iter()
            .filter(|f| f.file_name.starts_with("assets/") && !core.contains(&f.file_name))
            .filter(|f| f.file_name.ends_with(".js") || f.file_name.ends_with(".woff2") || f.contents.len() < 50_000)
            .map(|f| f.file_name.clone())
            .collect();
        let names: Vec<&str> = files.iter().map(|f| f.file_name.as_str()).collect();
        let version = content_hash(names.join("\n").as_bytes());
        files.push(EmittedFile {
            file_name: "sw.js".into(),
            contents: crate::production::service_worker(&version, base, &core, &other).into_bytes(),
        });
    }
    if let Some(code) = server {
        // Next.js middleware and route handlers, run by `noru start` with Node.js.
        files.push(EmittedFile { file_name: "server/app.js".into(), contents: code.into_bytes() });
        files.push(EmittedFile {
            file_name: "server/runtime.js".into(),
            contents: crate::next::server::RUNTIME.as_bytes().to_vec(),
        });
    }

    // Write the files and their precompressed versions (.br, .gz), served as-is by `noru start`.
    let outputs: Vec<Result<OutputFile, BuildError>> = {
        use rayon::prelude::*;
        files.par_iter().map(|file| write_output(out_dir, file)).collect()
    };
    let outputs: Vec<OutputFile> = outputs.into_iter().collect::<Result<_, _>>()?;

    profile("write + compress");
    // Page weights: the entry file, the CSS and the chunks of the page.
    let brotli_of = |name: &str| {
        outputs
            .iter()
            .find(|o| o.file_name == name)
            .map_or(0, |o| if o.brotli_size > 0 { o.brotli_size } else { o.size })
    };
    let pages: Vec<PageWeight> = bundle
        .pages
        .iter()
        .map(|(route, chunks)| {
            let files: Vec<String> =
                std::iter::once(js_name.clone()).chain(css_name.clone()).chain(chunks.iter().cloned()).collect();
            let bytes = files.iter().map(|f| brotli_of(f)).sum();
            PageWeight { route: route.clone(), files, bytes }
        })
        .collect();

    let budget = budget_kb(options, &project.root);
    let report = if options.report {
        let modules: Vec<ReportModule> = bundle
            .module_sizes
            .into_iter()
            .map(|m| ReportModule { file: if m.file.is_empty() { js_name.clone() } else { m.file }, ..m })
            .collect();
        let path = project.root.join("noru-report.html");
        std::fs::write(&path, crate::production::report_html(&pages, &modules, budget))
            .map_err(|e| BuildError::one(format!("cannot write {}: {e}", path.display())))?;
        Some(path)
    } else {
        None
    };

    if let Some(budget) = budget {
        let over: Vec<String> = pages
            .iter()
            .filter(|p| p.bytes as f64 / 1000.0 > budget)
            .map(|p| format!("  {}  {:.1} kB", p.route, p.bytes as f64 / 1000.0))
            .collect();
        if !over.is_empty() {
            return Err(BuildError::one(format!(
                "{} page(s) over the budget of {budget} kB (JavaScript + CSS, Brotli):\n{}\nrun `noru build --report` to see what they are made of",
                over.len(),
                over.join("\n")
            )));
        }
    }

    Ok(BuildResult {
        out_dir: project.out_dir.clone(),
        files: outputs,
        warnings,
        module_count: bundle.module_count,
        removed_modules: bundle.removed_count,
        pages,
        report,
        duration: start.elapsed(),
    })
}

/// `@font-face` rules from Google Fonts, without comments and indentation.
fn compact_font_css(css: &str) -> String {
    let mut out = String::with_capacity(css.len());
    for line in css.lines() {
        let line = line.trim();
        if line.is_empty() || (line.starts_with("/*") && line.ends_with("*/")) {
            continue;
        }
        out.push_str(&line.replace(": ", ":"));
    }
    out.replace(";}", "}")
}

/// The budget: `--budget`, else `"noru": { "budget": 150 }` in package.json.
fn budget_kb(options: &BuildOptions, root: &Path) -> Option<f64> {
    options.budget_kb.or_else(|| {
        let text = std::fs::read_to_string(root.join("package.json")).ok()?;
        let json: serde_json::Value = serde_json::from_str(&text).ok()?;
        json.get("noru")?.get("budget")?.as_f64()
    })
}

/// Writes a file of the build, plus `.br` and `.gz` versions of text files.
fn write_output(out_dir: &Path, file: &EmittedFile) -> Result<OutputFile, BuildError> {
    let path = out_dir.join(&file.file_name);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| BuildError::one(format!("cannot create {}: {e}", parent.display())))?;
    }
    let write = |path: &Path, bytes: &[u8]| {
        std::fs::write(path, bytes).map_err(|e| BuildError::one(format!("cannot write {}: {e}", path.display())))
    };
    write(&path, &file.contents)?;
    let compress = crate::production::is_compressible(&file.file_name)
        && file.contents.len() >= 1024
        && !file.file_name.starts_with("server/");
    let (gzip_size, brotli_size) = if compress {
        let br = crate::production::brotli(&file.contents);
        let gz = crate::production::gzip_best(&file.contents);
        let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        if !br.is_empty() && br.len() < file.contents.len() {
            write(&path.with_file_name(format!("{name}.br")), &br)?;
        }
        if !gz.is_empty() && gz.len() < file.contents.len() {
            write(&path.with_file_name(format!("{name}.gz")), &gz)?;
        }
        (gz.len(), br.len())
    } else {
        (gzip_size(&file.contents), 0)
    };
    Ok(OutputFile { file_name: file.file_name.clone(), size: file.contents.len(), gzip_size, brotli_size })
}

/// Inline script: preloads the chunks of the requested page, so they download with the entry file.
fn preload_script(base: &str, pages: &[(String, Vec<String>)]) -> String {
    // Most specific routes first: static segments before [param], before catch-alls.
    let mut routes: Vec<(String, &Vec<String>, (usize, usize))> = pages
        .iter()
        .filter(|(_, chunks)| !chunks.is_empty())
        .map(|(route, chunks)| {
            let catch_all = route.matches("[...").count() + route.matches("[[...").count();
            let dynamic = route.matches('[').count();
            (route_regex(route), chunks, (catch_all, dynamic))
        })
        .collect();
    routes.sort_by_key(|(_, _, rank)| *rank);
    let table: Vec<serde_json::Value> = routes.iter().map(|(re, chunks, _)| serde_json::json!([re, chunks])).collect();
    let table = serde_json::to_string(&table).unwrap_or_default().replace("</", "<\\/");
    let base_js = serde_json::to_string(base).unwrap_or_default();
    format!(
        "    <script>(function(){{var b={base_js},r={table},p=location.pathname;if(p.indexOf(b)===0)p=\"/\"+p.slice(b.length);p=p.replace(/\\/+$/,\"\")||\"/\";for(var i=0;i<r.length;i++)if(new RegExp(r[i][0]).test(p)){{r[i][1].forEach(function(f){{var l=document.createElement(\"link\");l.rel=\"modulepreload\";l.crossOrigin=\"\";l.href=b+f;document.head.appendChild(l)}});break}}}})()</script>\n"
    )
}

/// `/blog/[slug]` -> `^/blog/[^/]+$` (matched against the path without trailing slash).
fn route_regex(route: &str) -> String {
    let mut re = String::from("^");
    for segment in route.split('/').filter(|s| !s.is_empty()) {
        if segment.starts_with("[[...") {
            re.push_str("(?:/.*)?");
        } else if segment.starts_with("[...") {
            re.push_str("/.+");
        } else if segment.starts_with('[') {
            re.push_str("/[^/]+");
        } else {
            re.push('/');
            for c in segment.chars() {
                if !c.is_alphanumeric() && c != '-' && c != '_' {
                    re.push('\\');
                }
                re.push(c);
            }
        }
    }
    if re == "^" {
        re.push('/');
    }
    re.push('$');
    re
}

fn prepare_out_dir(out_dir: &Path, root: &Path, empty: bool) -> Result<(), String> {
    if out_dir == root || root.starts_with(out_dir) {
        return Err(format!("refusing to use {} as output directory: it contains the project", out_dir.display()));
    }
    if empty && out_dir.exists() {
        if !out_dir.starts_with(root) {
            return Err(format!(
                "output directory {} is outside the project root; refusing to empty it",
                out_dir.display()
            ));
        }
        std::fs::remove_dir_all(out_dir).map_err(|e| format!("cannot empty {}: {e}", out_dir.display()))?;
    }
    std::fs::create_dir_all(out_dir).map_err(|e| format!("cannot create {}: {e}", out_dir.display()))
}

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

fn gzip_size(bytes: &[u8]) -> usize {
    let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    if encoder.write_all(bytes).is_err() {
        return 0;
    }
    encoder.finish().map(|v| v.len()).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn route_patterns_for_preloading() {
        assert_eq!(route_regex("/"), "^/$");
        assert_eq!(route_regex("/blog/[slug]"), "^/blog/[^/]+$");
        assert_eq!(route_regex("/docs/[...path]"), "^/docs/.+$");
        assert_eq!(route_regex("/[[...all]]"), "^(?:/.*)?$");
        assert_eq!(crate::next::prerender::file_name("/"), "index.html");
        assert_eq!(crate::next::prerender::file_name("/dashboard/settings"), "dashboard/settings/index.html");
    }

    #[test]
    fn compacts_google_font_css() {
        let css = "/* latin */\n@font-face {\n  font-family: 'Geist';\n  font-weight: 400;\n}\n";
        assert_eq!(compact_font_css(css), "@font-face {font-family:'Geist';font-weight:400}");
    }
}
