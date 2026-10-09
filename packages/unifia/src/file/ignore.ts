
import { extname, basename } from "node:path"
import { Glob } from "../util/glob"

export namespace FileIgnore {
  const FOLDERS = new Set([
    "node_modules",
    "bower_components",
    ".pnpm-store",
    "vendor",
    ".npm",
    "dist",
    "build",
    "out",
    ".next",
    "target",
    "bin",
    "obj",
    ".git",
    ".svn",
    ".hg",
    ".vscode",
    ".idea",
    ".turbo",
    ".output",
    "desktop",
    ".sst",
    ".cache",
    ".webkit-cache",
    "__pycache__",
    ".pytest_cache",
    "mypy_cache",
    ".history",
    ".gradle",
  ])

  /** Folder patterns matched by glob (for names like results-*) */
  const FOLDER_GLOBS = ["results-*"]

  const FILES = [
    "**/*.swp",
    "**/*.swo",

    "**/*.pyc",

    // OS
    "**/.DS_Store",
    "**/Thumbs.db",

    // Logs & temp
    "**/logs/**",
    "**/tmp/**",
    "**/temp/**",
    "**/*.log",

    // Coverage/test outputs
    "**/coverage/**",
    "**/.nyc_output/**",

    // Lock files
    "**/package-lock.json",
    "**/yarn.lock",
    "**/pnpm-lock.yaml",
    "**/bun.lockb",
    "**/bun.lock",
    "**/*.lock",

    // Source maps
    "**/*.map",

    // Binary files
    "**/*.png",
    "**/*.jpg",
    "**/*.jpeg",
    "**/*.gif",
    "**/*.bmp",
    "**/*.ico",
    "**/*.webp",
    "**/*.svg",
    "**/*.wasm",
    "**/*.so",
    "**/*.dll",
    "**/*.exe",
    "**/*.dylib",
    "**/*.a",
    "**/*.o",
    "**/*.obj",
    "**/*.gguf",
    "**/*.bin",
    "**/*.tar",
    "**/*.gz",
    "**/*.zip",
    "**/*.7z",
    "**/*.rar",
    "**/*.pdf",
    "**/*.ttf",
    "**/*.otf",
    "**/*.woff",
    "**/*.woff2",
    "**/*.mp3",
    "**/*.mp4",
    "**/*.wav",
    "**/*.avi",
    "**/*.mov",
  ]

  export const PATTERNS = [...FILES, ...FOLDERS]

  /**
   * Ceiling on how deeply a brace pattern may nest.
   *
   * GHSA-vfj7-8cjw-p6xm is a high stack-exhaustion advisory against
   * `braces <= 3.0.3`, and 3.0.3 is the newest version npm publishes, so there
   * is nothing to bump to. What the installed version actually does was measured
   * rather than assumed: `micromatch.makeRe` — which is what
   * `@parcel/watcher`'s wrapper calls on every ignore pattern — takes 46 ms at
   * 1000 nested braces, 783 ms at 5000, and 12 731 ms at 20000, before V8's own
   * regex length ceiling refuses the input near 100 000. Superlinear cost rather
   * than a stack overflow, but a denial of service either way. See
   * docs/security/DEPENDENCY-ACCEPTANCES.md.
   *
   * The bound is kept because the reachability is real and the upstream fix is
   * not: `config.ts` merges project config files found by walking up from the
   * working directory, so a cloned repository can put a pattern into
   * `watcher.ignore` and from there into the compiler. Refusing it at the
   * boundary is cheaper than trusting a length check three packages down to
   * keep existing.
   *
   * The product's own patterns never nest at all, so this constrains nothing
   * legitimate.
   */
  export const MAX_BRACE_DEPTH = 32

  /** True when the pattern nests braces deeper than {@link MAX_BRACE_DEPTH}. */
  export function isPathologicalPattern(pattern: string): boolean {
    let depth = 0
    for (let i = 0; i < pattern.length; i++) {
      if (pattern[i] === "{") depth++
      else if (pattern[i] === "}") depth--
      if (depth > MAX_BRACE_DEPTH) return true
    }
    return depth > MAX_BRACE_DEPTH
  }

  /**
   * Drops patterns too nested to compile safely, and says which were dropped.
   *
   * A dropped pattern is not silently ignored: an ignore pattern that is not
   * honoured means the watcher watches more than the user asked, so the caller
   * logs it.
   */
  export function boundPatterns(patterns: readonly string[]): { kept: string[]; dropped: string[] } {
    const kept: string[] = []
    const dropped: string[] = []
    for (const pattern of patterns) {
      if (isPathologicalPattern(pattern)) dropped.push(pattern)
      else kept.push(pattern)
    }
    return { kept, dropped }
  }

  export function match(
    filepath: string,
    opts?: {
      extra?: string[]
      whitelist?: string[]
    },
  ) {
    for (const pattern of opts?.whitelist || []) {
      if (Glob.match(pattern, filepath)) return false
    }

    const parts = filepath.split(/[/\\]/)
    for (let i = 0; i < parts.length; i++) {
      if (FOLDERS.has(parts[i])) return true
      for (const glob of FOLDER_GLOBS) {
        if (Glob.match(glob, parts[i])) return true
      }
    }

    const extra = opts?.extra || []
    for (const pattern of [...FILES, ...extra]) {
      if (Glob.match(pattern, filepath)) return true
    }

    return false
  }

  // ─── Indexable file filter (shared by project-context & RAG) ──────────

  const SOURCE_EXTENSIONS = new Set([
    ".rs", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".py", ".go",
    ".c", ".cpp", ".h", ".hpp", ".java", ".kt", ".swift",
    ".rb", ".php", ".vue", ".svelte", ".css", ".scss", ".html",
    ".sql", ".sh", ".bash",
  ])

  const CONFIG_EXTENSIONS = new Set([
    ".toml", ".yaml", ".yml", ".json", ".md", ".txt",
  ])

  /** Well-known config files that should always be indexable regardless of extension rules. */
  const ALWAYS_INDEX = new Set([
    "Cargo.toml", "package.json", "tsconfig.json", "Dockerfile",
    "Makefile", "CMakeLists.txt", "go.mod", "go.sum",
    "pyproject.toml", "setup.py", "setup.cfg",
  ])

  /**
   * Determine if a file should be indexed for RAG / project context.
   * Call AFTER `match()` to check ignore patterns — this only checks extension + size rules.
   *
   * @param relativePath - path relative to project root
   * @param lineCount - number of lines in the file
   * @param byteSize - optional file size in bytes (used for stricter JSON filtering)
   */
  /** Largest file any rule below can accept: 1,000 source lines of up to 256 bytes. */
  export const MAX_INDEXABLE_BYTES = 256 * 1024

  /**
   * Whether a file could pass `isIndexable`, decided from its name and size
   * alone, so callers never read a file no rule accepts — a photo, a video, a
   * database — only to count its lines.
   */
  export function mayBeIndexable(relativePath: string, byteSize: number): boolean {
    if (byteSize > MAX_INDEXABLE_BYTES) return false
    return isIndexable(relativePath, 0, byteSize)
  }

  export function isIndexable(relativePath: string, lineCount: number, byteSize?: number): boolean {
    const name = basename(relativePath)
    const ext = extname(relativePath).toLowerCase()

    // Always-index well-known config files (unless absurdly large)
    if (ALWAYS_INDEX.has(name)) return lineCount <= 500

    // Source code files
    if (SOURCE_EXTENSIONS.has(ext)) return lineCount <= 1000

    // JSON: line count AND byte size — dense JSON dumps are few lines but huge
    if (ext === ".json") return lineCount <= 100 && (byteSize === undefined || byteSize <= 10_000)

    // Config / text files with tighter limits
    if (ext === ".md" || ext === ".txt") return lineCount <= 500
    if (CONFIG_EXTENSIONS.has(ext)) return lineCount <= 500

    // Unknown extension — skip
    return false
  }
}
