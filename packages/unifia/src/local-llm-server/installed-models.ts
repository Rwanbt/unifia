/* SPDX-License-Identifier: MIT */

/**
 * Which configured local models are actually installed.
 *
 * The app registers local models into the global config, and the config update
 * merges: it never deletes a key. A model deleted from disk therefore stayed in
 * the `local-llm` provider forever, listed in every model picker and impossible
 * to remove. The models directory is the source of truth; the config only
 * carries per-model settings.
 */

const GGUF_EXTENSION = /\.gguf$/i
const QUANT_SUFFIX = /[-_](q\d+(_[a-z0-9]+)*|iq\d+(_[a-z0-9]+)*|f16|fp16|bf16|f32|fp32)$/i

/** Runnable model files: `.gguf`, excluding vision projectors (`mmproj-*`). */
export function runnableModelFiles(files: readonly string[]): string[] {
  return files.filter((file) => GGUF_EXTENSION.test(file) && !file.toLowerCase().startsWith("mmproj"))
}

/**
 * The file serving `modelID`: an exact name first, then the name without its
 * quantization suffix (`gemma-4-E4B-it` → `gemma-4-E4B-it-Q4_K_M.gguf`).
 */
export function findInstalledModelFile(modelID: string, files: readonly string[]): string | undefined {
  const wanted = modelID.toLowerCase()
  const ggufs = files.filter((file) => GGUF_EXTENSION.test(file))
  const exact = ggufs.find((file) => file.toLowerCase() === wanted || file.toLowerCase() === `${wanted}.gguf`)
  if (exact) return exact
  return ggufs.find((file) => file.replace(GGUF_EXTENSION, "").replace(QUANT_SUFFIX, "").toLowerCase() === wanted)
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"])

/**
 * Whether a `local-llm` provider points at the llama-server this app manages.
 * A user may point `local-llm` at another server (Ollama, LM Studio) whose
 * models are not files in our models directory; those must not be pruned.
 */
export function servesManagedRuntime(baseURL: unknown, managedPort: number): boolean {
  if (baseURL === undefined) return true
  if (typeof baseURL !== "string") return false
  try {
    const url = new URL(baseURL)
    return LOOPBACK_HOSTS.has(url.hostname) && Number(url.port) === managedPort
  } catch {
    return false
  }
}

/** Keeps only the models whose file is installed. */
export function pruneToInstalled<T>(models: Record<string, T>, files: readonly string[]): Record<string, T> {
  const runnable = runnableModelFiles(files)
  return Object.fromEntries(
    Object.entries(models).filter(([modelID]) => findInstalledModelFile(modelID, runnable) !== undefined),
  )
}
