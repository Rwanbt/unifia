/* SPDX-License-Identifier: MIT */
import fs from "node:fs"
import path from "node:path"

const stem = (name: string) => name.replace(/\.gguf$/i, "").replace(/[-_]Q\d.*$/i, "").toLowerCase()

export function readMobileLoadFailure(home: string | undefined, model: string): string | undefined {
  if (!home || !model) return
  let data: string
  try {
    data = fs.readFileSync(path.join(path.dirname(home), "llm_ipc", "load_failure"), "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return
    throw error
  }
  const [name, message] = data.split("\n")
  if (!name || !message || stem(name) !== stem(model)) return
  return `[LocalLLMServer] Mobile model ${name} failed to load: ${message}`
}
