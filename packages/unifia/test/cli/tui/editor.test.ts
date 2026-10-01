// SPDX-License-Identifier: MIT
import { expect, test } from "bun:test"
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { CliRenderer } from "@opentui/core"
import { Editor } from "@/cli/cmd/tui/util/editor"

test("editor creates private isolated files and removes them after exit", async () => {
  const root = join(tmpdir(), `unifia-editor-test-${process.pid}-${Date.now()}`)
  const reports = join(root, "reports")
  const temp = join(root, "temp")
  await mkdir(reports, { recursive: true })
  await mkdir(temp, { recursive: true })

  const script = join(root, "editor.cjs")
  await writeFile(
    script,
    `const fs = require("node:fs")
const path = require("node:path")
const filepath = process.argv.at(-1)
const dir = path.dirname(filepath)
const report = { filepath, content: fs.readFileSync(filepath, "utf8"), fileMode: fs.statSync(filepath).mode & 0o777, dirMode: fs.statSync(dir).mode & 0o777 }
fs.writeFileSync(path.join(${JSON.stringify(reports)}, path.basename(dir) + ".json"), JSON.stringify(report))
fs.writeFileSync(filepath, report.content.toUpperCase())
`,
  )

  const envKeys = ["VISUAL", "EDITOR", "TEMP", "TMP", "TMPDIR"] as const
  const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]))
  const renderer = {
    suspend() {},
    currentRenderBuffer: { clear() {} },
    resume() {},
    requestRender() {},
  } as unknown as CliRenderer

  try {
    process.env["VISUAL"] = `node ${script}`
    delete process.env["EDITOR"]
    process.env["TEMP"] = temp
    process.env["TMP"] = temp
    process.env["TMPDIR"] = temp

    const [first, second] = await Promise.all([
      Editor.open({ value: "first editor", renderer }),
      Editor.open({ value: "second editor", renderer }),
    ])

    expect(first).toBe("FIRST EDITOR")
    expect(second).toBe("SECOND EDITOR")

    const files = await readdir(reports)
    expect(files).toHaveLength(2)
    const result = await Promise.all(files.map(async (file) => JSON.parse(await readFile(join(reports, file), "utf8"))))
    expect(new Set(result.map((item) => item.filepath)).size).toBe(2)
    expect(result.map((item) => item.content).sort()).toEqual(["first editor", "second editor"])
    expect(await readdir(temp)).toEqual([])

    if (process.platform !== "win32") {
      expect(result.every((item) => item.fileMode === 0o600 && item.dirMode === 0o700)).toBe(true)

      process.env["VISUAL"] = `unifia-missing-editor-${process.pid}`
      await expect(Editor.open({ value: "startup failure", renderer })).rejects.toThrow()
      expect(await readdir(temp)).toEqual([])
    }
  } finally {
    for (const key of envKeys) {
      if (previous[key] === undefined) delete process.env[key]
      else process.env[key] = previous[key]
    }
    await rm(root, { recursive: true, force: true })
  }
})
