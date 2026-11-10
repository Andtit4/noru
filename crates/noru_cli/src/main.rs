use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand};
use noru_core::{BuildOptions, BuildResult, DevOptions, DevServer, PreviewServer};

#[derive(Parser)]
#[command(name = "noru", version, about = "A fast bundler for web apps, written in Rust")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Build the app for production
    Build {
        /// Project root (folder containing index.html)
        #[arg(default_value = ".")]
        root: PathBuf,
        /// Output directory (relative to root)
        #[arg(long, default_value = "dist")]
        out_dir: PathBuf,
        /// Public base path
        #[arg(long, default_value = "/")]
        base: String,
        /// Build mode (exposed as import.meta.env.MODE)
        #[arg(long, default_value = "production")]
        mode: String,
        /// Disable minification
        #[arg(long)]
        no_minify: bool,
        /// Disable tree-shaking (keep unused modules and exports)
        #[arg(long)]
        no_treeshake: bool,
    },
    /// Start the development server (everything pre-bundled in memory, instant reloads)
    Dev {
        /// Project root (folder containing index.html)
        #[arg(default_value = ".")]
        root: PathBuf,
        #[arg(long, short, default_value_t = 3000)]
        port: u16,
        /// Use 0.0.0.0 to expose the server on the local network
        #[arg(long, default_value = "127.0.0.1")]
        host: String,
        /// Public base path
        #[arg(long, default_value = "/")]
        base: String,
        /// Mode (exposed as import.meta.env.MODE)
        #[arg(long, default_value = "development")]
        mode: String,
    },
    /// Serve the production build (run `noru build` first). Uses $PORT when set.
    Start {
        /// Project root
        #[arg(default_value = ".")]
        root: PathBuf,
        /// Output directory (relative to root)
        #[arg(long, default_value = "dist")]
        out_dir: PathBuf,
        #[arg(long, short, env = "PORT", default_value_t = 3000)]
        port: u16,
        #[arg(long, default_value = "0.0.0.0")]
        host: String,
    },
    /// Serve the build output locally (same as `start`, on port 4173 and localhost)
    Preview {
        /// Project root
        #[arg(default_value = ".")]
        root: PathBuf,
        /// Output directory (relative to root)
        #[arg(long, default_value = "dist")]
        out_dir: PathBuf,
        #[arg(long, short, default_value_t = 4173)]
        port: u16,
        #[arg(long, default_value = "127.0.0.1")]
        host: String,
    },
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    match cli.command {
        Command::Dev { root, port, host, base, mode } => {
            let mut options = DevOptions::new(root);
            options.port = port;
            options.host = host;
            options.build.base = base;
            options.build.mode = mode;
            match DevServer::start(options) {
                Ok(server) => {
                    server.wait();
                    ExitCode::SUCCESS
                }
                Err(e) => {
                    eprintln!("{} {e}", color("31;1", "x"));
                    ExitCode::FAILURE
                }
            }
        }
        Command::Start { root, out_dir, port, host } => serve_build(root, out_dir, port, host),
        Command::Preview { root, out_dir, port, host } => serve_build(root, out_dir, port, host),
        Command::Build { root, out_dir, base, mode, no_minify, no_treeshake } => {
            let options = BuildOptions {
                out_dir,
                base,
                mode,
                minify: !no_minify,
                treeshake: !no_treeshake,
                ..BuildOptions::new(root)
            };
            println!(
                "{} {} building for {}...",
                color("36;1", "noru"),
                color("2", &format!("v{}", noru_core::VERSION)),
                options.mode
            );
            match noru_core::build(&options) {
                Ok(result) => {
                    print_result(&result);
                    ExitCode::SUCCESS
                }
                Err(err) => {
                    eprintln!("{} build failed\n", color("31;1", "x"));
                    for message in &err.messages {
                        eprintln!("{message}\n");
                    }
                    ExitCode::FAILURE
                }
            }
        }
    }
}

fn serve_build(root: PathBuf, out_dir: PathBuf, port: u16, host: String) -> ExitCode {
    let dir = if out_dir.is_absolute() { out_dir } else { root.join(out_dir) };
    if !dir.join("index.html").is_file() {
        eprintln!("{} no build found in {} — run `noru build` first", color("31;1", "x"), dir.display());
        return ExitCode::FAILURE;
    }
    match PreviewServer::bind(&dir, &host, port) {
        Ok(server) => {
            let port = server.local_addr().map(|a| a.port()).unwrap_or(port);
            let shown = if host == "0.0.0.0" || host == "127.0.0.1" { "localhost" } else { host.as_str() };
            println!(
                "\n  {} serving {}\n\n  {}  Local:   {}\n",
                color("36;1", "noru"),
                dir.display(),
                color("32", "➜"),
                color("36", &format!("http://{shown}:{port}/"))
            );
            server.run();
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("{} cannot listen on {host}:{port}: {e}", color("31;1", "x"));
            ExitCode::FAILURE
        }
    }
}

fn print_result(result: &BuildResult) {
    for warning in &result.warnings {
        println!("{} {warning}", color("33;1", "warning:"));
    }
    let removed = if result.removed_modules > 0 {
        format!(" ({} unused removed by tree-shaking)", result.removed_modules)
    } else {
        String::new()
    };
    println!("{} {} modules transformed{removed}.", color("32", "✓"), result.module_count);
    let out = result.out_dir.file_name().and_then(|n| n.to_str()).unwrap_or("dist");
    let names: Vec<String> = result.files.iter().map(|f| format!("{out}/{}", f.file_name)).collect();
    let width = names.iter().map(String::len).max().unwrap_or(0);
    let size_width = result.files.iter().map(|f| kb(f.size).len()).max().unwrap_or(0);
    for (file, name) in result.files.iter().zip(&names) {
        let code = if name.ends_with(".js") {
            "36"
        } else if name.ends_with(".css") {
            "35"
        } else if name.ends_with(".html") {
            "32"
        } else {
            "2"
        };
        println!(
            "{}{}  {:>size_width$} │ gzip: {:>8}",
            color(code, name),
            " ".repeat(width - name.len()),
            kb(file.size),
            kb(file.gzip_size),
        );
    }
    println!("{} built in {}ms", color("32", "✓"), result.duration.as_millis());
}

fn kb(bytes: usize) -> String {
    format!("{:.2} kB", bytes as f64 / 1000.0)
}

fn color(code: &str, text: &str) -> String {
    if std::env::var_os("NO_COLOR").is_some() {
        text.to_string()
    } else {
        format!("\x1b[{code}m{text}\x1b[0m")
    }
}
