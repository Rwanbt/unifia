/* SPDX-License-Identifier: MIT */
/**
 * The project-context scan runs before every model call. On Android the
 * session directory is the whole device storage, and the scan used to read
 * every file below it — every photo and video — before looking at its type,
 * which left the prompt "thinking" forever. These tests pin that the scan
 * never reads a file no rule can index and keeps its 50-recent-files contract.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import fs, { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { FileIgnore } from "../../src/file/ignore"
import { ProjectContext } from "../../src/session/project-context"

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "unifia-project-context-"))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function write(relative: string, content: string | Buffer, mtimeSeconds?: number) {
  const file = join(root, relative)
  mkdirSync(join(file, ".."), { recursive: true })
  writeFileSync(file, content)
  if (mtimeSeconds !== undefined) utimesSync(file, mtimeSeconds, mtimeSeconds)
}

describe("ProjectContext.scanFiles", () => {
  it("never reads media, oversized or ignored files, and still finds the source", async () => {
    write("src/app.ts", "export const app = 1\n")
    write("DCIM/Camera/clip.mp4", Buffer.alloc(3 * 1024 * 1024))
    write("src/generated.ts", "x".repeat(FileIgnore.MAX_INDEXABLE_BYTES + 1))
    write("node_modules/pkg/index.ts", "export const dep = 1\n")
    write(".hidden/secret.ts", "export const hidden = 1\n")
    const readFile = spyOn(fs.promises, "readFile")

    const files = await ProjectContext.scanFiles(root)

    expect(files.map((file) => file.relativePath.replaceAll("\\", "/"))).toEqual(["src/app.ts"])
    const read = readFile.mock.calls.map(([path]) => String(path).replaceAll("\\", "/"))
    expect(read).toEqual([join(root, "src/app.ts").replaceAll("\\", "/")])
    readFile.mockRestore()
  })

  it("keeps the 50 most recently modified indexable files", async () => {
    for (let index = 0; index < 60; index++) write(`src/file-${index}.ts`, `export const v${index} = ${index}\n`, 1_000 + index)

    const files = await ProjectContext.scanFiles(root)

    expect(files).toHaveLength(50)
    expect(files[0].relativePath).toContain("file-59.ts")
    expect(files.at(-1)?.relativePath).toContain("file-10.ts")
  })

  it("returns nothing for a directory that does not exist", async () => {
    expect(await ProjectContext.scanFiles(join(root, "missing"))).toEqual([])
  })
})

describe("FileIgnore.mayBeIndexable", () => {
  it("decides from name and size alone", () => {
    expect(FileIgnore.mayBeIndexable("src/main.rs", 4_000)).toBe(true)
    expect(FileIgnore.mayBeIndexable("DCIM/photo.jpg", 4_000)).toBe(false)
    expect(FileIgnore.mayBeIndexable("src/huge.ts", FileIgnore.MAX_INDEXABLE_BYTES + 1)).toBe(false)
    expect(FileIgnore.mayBeIndexable("data/dump.json", 20_000)).toBe(false)
  })
})
