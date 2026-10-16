// SPDX-License-Identifier: MIT
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { REPO_ROOT, hashCanonical } from "./shared"
import { assertBrandCssSync, canonicalTokens } from "./tokens-canonical"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("RC-1 token audit canonical inputs", () => {
  test("enumerating the same CSS files in either order yields the same inventory and hash", () => {
    const input = {
      counts: { files: 2, declarations: 3, usages: 2, selectors: 2 },
      declarations: [
        { file: "z.css", property: "v110-rail", value: "62px" },
        { file: "a.css", property: "v110-chat", value: "348px" },
        { file: "a.css", property: "v110-chat", value: "330px" },
      ],
      usages: [
        { file: "z.css", property: "v110-rail", count: 3 },
        { file: "a.css", property: "v110-chat", count: 1 },
      ],
      selectors: [
        { file: "z.css", selector: "rail" },
        { file: "a.css", selector: "shell" },
      ],
    }
    const reverse = {
      ...input,
      declarations: [...input.declarations.slice(1), input.declarations[0]!],
      usages: [...input.usages].reverse(),
      selectors: [...input.selectors].reverse(),
    }
    const first = canonicalTokens(input)
    const second = canonicalTokens(reverse)
    expect(second).toEqual(first)
    expect(hashCanonical(second)).toBe(hashCanonical(first))
    expect(first.declarations.filter((token) => token.file === "a.css").map((token) => token.value)).toEqual([
      "348px",
      "330px",
    ])

    const changed = canonicalTokens({
      ...input,
      declarations: input.declarations.map((token) => (token.value === "62px" ? { ...token, value: "63px" } : token)),
    })
    expect(hashCanonical(changed)).not.toBe(hashCanonical(first))

    const reorderedOverrides = canonicalTokens({
      ...input,
      declarations: [input.declarations[0]!, input.declarations[2]!, input.declarations[1]!],
    })
    expect(hashCanonical(reorderedOverrides)).not.toBe(hashCanonical(first))
  })

  test("the shipped brand CSS must match its repository source and fail when missing or changed", () => {
    assertBrandCssSync(REPO_ROOT)
    const root = mkdtempSync(join(tmpdir(), "unifia-tokens-"))
    roots.push(root)
    mkdirSync(join(root, "brand", "unifia"), { recursive: true })
    mkdirSync(join(root, "packages", "app", "src", "styles"), { recursive: true })
    const source = join(root, "brand", "unifia", "unifia.css")
    const shipped = join(root, "packages", "app", "src", "styles", "unifia-brand.css")

    expect(() => assertBrandCssSync(root)).toThrow()
    writeFileSync(source, ":root { --unifia-code: #4885F3; }")
    writeFileSync(shipped, ":root { --unifia-code: #4885F3; }")
    expect(() => assertBrandCssSync(root)).not.toThrow()
    writeFileSync(shipped, ":root { --unifia-code: #000000; }")
    expect(() => assertBrandCssSync(root)).toThrow("Brand CSS drift")
  })

  test("the real audit hashes the sorted inventory it actually emits", () => {
    const result = Bun.spawnSync({
      cmd: [process.execPath, "run", "scripts/parity/tokens-audit.ts", "--emit=stdout"],
      cwd: join(REPO_ROOT, "packages", "app"),
      stdout: "pipe",
      stderr: "pipe",
    })
    expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0)
    const report = JSON.parse(new TextDecoder().decode(result.stdout))
    expect(report.counts.files).toBeGreaterThan(0)
    expect(report.counts.v110Properties).toBeGreaterThan(0)
    expect(report.canonicalHash).toBe(
      hashCanonical({
        declarations: report.declarations,
        usages: report.usages,
        selectors: report.selectors,
        counts: report.counts,
      }),
    )
    expect(
      canonicalTokens({
        declarations: report.declarations,
        usages: report.usages,
        selectors: report.selectors,
        counts: report.counts,
      }),
    ).toEqual({
      counts: report.counts,
      declarations: report.declarations,
      usages: report.usages,
      selectors: report.selectors,
    })
  })
})
