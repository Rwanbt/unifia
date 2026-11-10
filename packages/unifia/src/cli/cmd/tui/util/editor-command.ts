import path from "node:path"
import { which } from "@/util/which"

export type Plan = { shell: false; argv: string[] } | { shell: true; line: string }

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

// WHY: cmd.exe is the only thing that can execute a `.cmd`/`.bat` file -
// CreateProcess cannot - so the shell path is reserved for that shim. Every
// other editor, including a Windows `.exe`, runs as an argv without a shell.
function shim(bin: string, platform: NodeJS.Platform) {
  return platform === "win32" && /\.(cmd|bat)$/i.test(bin)
}

/** Strict quoting for the cmd.exe shim: `& | > < ^` are only literal inside
 *  double quotes, and `%` still expands there, so `%` and `"` are refused
 *  rather than guessed at. */
export function quote(arg: string): string {
  if (/[\0\r\n"%]/.test(arg)) {
    throw new Error("editor command contains a character that cannot be quoted safely for cmd.exe")
  }
  return `"${arg}"`
}

export function plan(editor: string, filepath: string, platform: NodeJS.Platform = process.platform): Plan {
  const parts = split(editor)
  const bin = parts[0]
  if (!bin) throw new Error("editor command is empty")
  const resolved = path.isAbsolute(bin) ? bin : which(bin) ?? bin
  const argv = [resolved, ...parts.slice(1), filepath]
  if (!shim(resolved, platform)) return { shell: false, argv }
  return { shell: true, line: argv.map(quote).join(" ") }
}
