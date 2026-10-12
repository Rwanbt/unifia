/* SPDX-License-Identifier: MIT */
import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { viteFinal } from "storybook-solidjs-vite/preset"
import type { Plugin } from "vite"

const root = fileURLToPath(new URL("../../../", import.meta.url))
const framework = { name: "storybook-solidjs-vite", options: {} }

async function docgenTransform() {
  if (!viteFinal) throw new Error("Framework Vite preset unavailable")
  const options = {
    configDir: fileURLToPath(new URL("./", import.meta.url)),
    presets: { apply: async () => framework },
  } as unknown as Parameters<typeof viteFinal>[1]
  const config = await viteFinal({ plugins: [{ name: "solid" }] }, options)
  const plugin = config.plugins?.find((entry) => entry && "name" in entry && entry.name === "storybook:solid-component-meta") as Plugin | undefined
  if (!plugin || typeof plugin.transform !== "function") throw new Error("Docgen transform unavailable")
  const transform = plugin.transform
  return (code: string, id: string) => transform.call({} as ThisParameterType<typeof transform>, code, id)
}

test("Docgen_ThirdPartyJsx_DoesNotLoadWorkspaceProgram", async () => {
  const transform = await docgenTransform()
  const before = process.memoryUsage().heapUsed
  const result = await transform("", `${root}/node_modules/@solidjs/meta/dist/index.jsx?import`)
  expect(result).toBeNull()
  expect(process.memoryUsage().heapUsed - before).toBeLessThan(64 * 1024 * 1024)
}, 30_000)

test("Docgen_WindowsThirdPartyPath_RemainsExcluded", async () => {
  const transform = await docgenTransform()
  expect(await transform("", `${root}/node_modules/@solidjs/meta/dist/index.jsx`.replaceAll("/", "\\"))).toBeNull()
}, 30_000)

test("Docgen_UnifiaButton_PreservesControlsMetadata", async () => {
  const transform = await docgenTransform()
  const path = `${root}/packages/ui/src/components/button.tsx`
  const result = await transform(await readFile(path, "utf8"), path)
  expect(result).toBeDefined()
  expect(typeof result === "object" && result && "code" in result ? result.code : result).toContain("Button.__docgenInfo")
  expect(typeof result === "object" && result && "code" in result ? result.code : result).toContain('"variant"')
}, 30_000)
