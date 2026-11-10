export interface BuildOptions {
  /** Project root, the folder containing index.html. Default: current directory. */
  root?: string
  /** Output directory, relative to root. Default: "dist". */
  outDir?: string
  /** Public base path. Default: "/". */
  base?: string
  /** Minify JS and CSS. Default: true. */
  minify?: boolean
  /** Build mode, exposed as `import.meta.env.MODE`. Default: "production". */
  mode?: string
  /** Folder copied as-is to the output. Default: "public". */
  publicDir?: string
  /** Assets smaller than this many bytes are inlined as data URLs. Default: 4096. */
  assetInlineLimit?: number
  /** Empty the output directory first. Default: true. */
  emptyOutDir?: boolean
  /** Remove unused modules, exports and code. Default: true. */
  treeshake?: boolean
}

export interface OutputFile {
  /** Path relative to the output directory. */
  fileName: string
  size: number
  gzipSize: number
}

export interface BuildResult {
  outDir: string
  files: OutputFile[]
  warnings: string[]
  moduleCount: number
  /** Modules left out of the bundle by tree-shaking. */
  removedModules: number
  durationMs: number
}

export interface DevOptions {
  /** Project root, the folder containing index.html. Default: current directory. */
  root?: string
  /** Port. Default: 3000 (0 picks a free port). */
  port?: number
  /** Host. Default: "127.0.0.1" (use "0.0.0.0" to expose on the network). */
  host?: string
  /** Public base path. Default: "/". */
  base?: string
  /** Mode, exposed as `import.meta.env.MODE`. Default: "development". */
  mode?: string
  /** Folder served as-is. Default: "public". */
  publicDir?: string
  /** Print startup and rebuild logs. Default: true. */
  log?: boolean
}

export interface DevServer {
  /** e.g. "http://127.0.0.1:3000/" */
  readonly url: string
  readonly port: number
  /** Stop the server and the file watcher. */
  close(): void
}

export interface PreviewOptions {
  root?: string
  outDir?: string
  port?: number
  host?: string
}

export interface PreviewServer {
  url: string
  close(): Promise<void>
}

/** Build the app for production. Rejects with the build errors on failure. */
export function build(options?: BuildOptions): Promise<BuildResult>
/** Synchronous version of `build`. */
export function buildSync(options?: BuildOptions): BuildResult
/**
 * Start the development server: the whole app is bundled in memory up-front (no per-page
 * compilation), then only changed files are re-processed and browsers reload automatically.
 */
export function startDevServer(options?: DevOptions): DevServer
/** Serve the production build (with a SPA fallback, gzip and long-term caching of hashed assets). */
export function preview(options?: PreviewOptions): Promise<PreviewServer>
/** Version of the npm package. */
export const version: string
/** Version of the native core. */
export const coreVersion: string
