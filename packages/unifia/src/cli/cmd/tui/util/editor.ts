import { defer } from "@/util/defer"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { CliRenderer } from "@opentui/core"
import { Filesystem } from "@/util/filesystem"
import { Process } from "@/util/process"

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
      const parts = editor.split(" ")
      const io = { stdin: "inherit", stdout: "inherit", stderr: "inherit" } as const
      // WHY: Windows needs a shell to resolve an editor configured as a `.cmd`
      // shim; POSIX does not, so it keeps the shell-free path. The command comes
      // from the user's own VISUAL/EDITOR, never from a request.
      const proc =
        process.platform === "win32"
          ? Process.spawnShell([...parts, filepath], { ...io, shell: true })
          : Process.spawn([...parts, filepath], io)
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
