//! noru — a fast bundler for web apps, written in Rust.
//!
//! ```no_run
//! let options = noru_core::BuildOptions::new("./my-app");
//! let result = noru_core::build(&options).expect("build failed");
//! println!("built {} files in {:?}", result.files.len(), result.duration);
//! ```

mod asset;
mod build;
mod bundle;
mod css;
mod dev;
mod env;
mod graph;
mod html;
mod js;
mod module;
mod next;
mod options;
mod pkg;
mod postcss;
mod resolve;
mod serve;
mod treeshake;

pub use build::{build, BuildError, BuildResult, OutputFile};
pub use dev::{DevOptions, DevServer};
pub use options::BuildOptions;
pub use serve::PreviewServer;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
