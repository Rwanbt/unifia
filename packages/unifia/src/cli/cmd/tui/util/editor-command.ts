import path from "node:path"
import { isShim } from "@/util/shim"
import { which } from "@/util/which"

export type Plan = { shim: boolean; argv: string[] }

/** Split `$VISUAL`/`$EDITOR` into argv, honouring double quotes so a path with
 *  spaces survives. A quote is literal shell syntax here, not part of the path. */
export function split(editor: string): string[] {
  const out: string[] = []
  let current = ""
  let quoted = false
  let started = false
  for (const char of editor) {
    if (char === '"') {
      quoted = !quoted
      started = true
      continue
    }
    if (!quoted && /\s/.test(char)) {
      if (started) out.push(current)
      current = ""
      started = false
      continue
    }
    current += char
    started = true
  }
  if (started) out.push(current)
  return out
}

export function plan(editor: string, filepath: string, platform: NodeJS.Platform = process.platform): Plan {
  const parts = split(editor)
  const bin = parts[0]
  if (!bin) throw new Error("editor command is empty")
  const resolved = path.isAbsolute(bin) ? bin : which(bin) ?? bin
  return { shim: isShim(resolved, platform), argv: [resolved, ...parts.slice(1), filepath] }
}
