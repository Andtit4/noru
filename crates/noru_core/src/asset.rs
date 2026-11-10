//! Static assets (images, fonts...): emitted with a content hash, or inlined as data URLs when small.

use std::path::Path;

use base64::Engine;

use crate::module::{content_hash, EmittedFile};

pub const ASSET_EXTENSIONS: &[&str] = &[
    "png",
    "jpg",
    "jpeg",
    "jfif",
    "pjpeg",
    "pjp",
    "gif",
    "svg",
    "ico",
    "webp",
    "avif",
    "bmp",
    "apng",
    "cur",
    "mp4",
    "webm",
    "ogg",
    "mp3",
    "wav",
    "flac",
    "aac",
    "opus",
    "mov",
    "m4a",
    "vtt",
    "woff",
    "woff2",
    "eot",
    "ttf",
    "otf",
    "webmanifest",
    "pdf",
    "txt",
    "wasm",
];

pub fn is_asset_extension(ext: &str) -> bool {
    ASSET_EXTENSIONS.contains(&ext)
}

pub fn mime_type(ext: &str) -> &'static str {
    match ext {
        "png" | "apng" => "image/png",
        "jpg" | "jpeg" | "jfif" | "pjpeg" | "pjp" => "image/jpeg",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "ico" | "cur" => "image/x-icon",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "ogg" => "audio/ogg",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "flac" => "audio/flac",
        "aac" => "audio/aac",
        "opus" => "audio/opus",
        "m4a" => "audio/mp4",
        "vtt" => "text/vtt",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "eot" => "application/vnd.ms-fontobject",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "webmanifest" => "application/manifest+json",
        "pdf" => "application/pdf",
        "txt" => "text/plain",
        "wasm" => "application/wasm",
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json",
        _ => "application/octet-stream",
    }
}

pub struct AssetOptions<'a> {
    pub base: &'a str,
    pub inline_limit: usize,
}

/// Returns the public URL of the asset and the file to emit (if not inlined).
pub fn process_asset(path: &Path, opts: &AssetOptions) -> Result<(String, Option<EmittedFile>), String> {
    let bytes = std::fs::read(path).map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    // Fonts and media are never inlined (browsers handle them better as separate files), like Vite.
    let inlinable = !matches!(ext.as_str(), "woff" | "woff2" | "eot" | "ttf" | "otf" | "mp4" | "webm" | "mp3" | "wasm");
    if inlinable && bytes.len() < opts.inline_limit {
        let data = base64::engine::general_purpose::STANDARD.encode(&bytes);
        return Ok((format!("data:{};base64,{data}", mime_type(&ext)), None));
    }
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("asset");
    let stem: String =
        stem.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).collect();
    let file_name = format!("assets/{stem}-{}.{ext}", content_hash(&bytes));
    let url = format!("{}{file_name}", opts.base);
    Ok((url, Some(EmittedFile { file_name, contents: bytes })))
}
