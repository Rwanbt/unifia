import { defer } from "@/util/defer"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { CliRenderer } from "@opentui/core"
import { Filesystem } from "@/util/filesystem"
import { Process } from "@/util/process"
import { plan } from "./editor-command"

export namespace Editor {
  export async function open(opts: { value: string; renderer: CliRenderer }): Promise<string | undefined> {
    const editor = process.env["VISUAL"] || process.env["EDITOR"]
    if (!editor) return

    const dir = await mkdtemp(join(tmpdir(), "unifia-editor-"))
    await using _ = defer(async () => rm(dir, { recursive: true, force: true }))
    const filepath = join(dir, "input.md")

    await writeFile(filepath, opts.value, { flag: "wx", mode: 0o600 })
    opts.renderer.suspend()
    opts.renderer.currentRenderBuffer.clear()
    try {
      const cmd = plan(editor, filepath)
      const io = { stdin: "inherit", stdout: "inherit", stderr: "inherit" } as const
      // WHY: only a Windows `.cmd`/`.bat` shim needs cmd.exe. Every other
      // editor, including a Windows `.exe`, is spawned directly by Node - not
      // through cross-spawn, whose Windows `.cmd` fallback is a shell sink.
      const proc = cmd.shell
        ? Process.spawnShell([cmd.line], { ...io, shell: true })
        : Process.spawnDirect(cmd.argv, io)
      await proc.exited
      const content = await Filesystem.readText(filepath)
      return content || undefined
    } finally {
      opts.renderer.currentRenderBuffer.clear()
      opts.renderer.resume()
      opts.renderer.requestRender()
    }
  }
}
