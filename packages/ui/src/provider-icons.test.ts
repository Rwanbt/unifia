/* SPDX-License-Identifier: MIT */

import { expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fetchProviderIcons, providerIconFilename, providerIconsPlugin } from "./provider-icons"

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>'

async function withCatalog(
  catalog: unknown,
  run: (fixture: { url: string; output: string; requests: string[] }) => Promise<void>,
  options: { catalogStatus?: number; iconStatus?: number } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "unifia-provider-icons-"))
  const output = join(directory, "icons")
  await mkdir(output)
  const requests: string[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const pathname = new URL(request.url).pathname
      requests.push(pathname)
      if (pathname === "/api.json") return Response.json(catalog, { status: options.catalogStatus ?? 200 })
      return new Response(SVG, { status: options.iconStatus ?? 200 })
    },
  })
  try {
    await run({ url: server.url.origin, output, requests })
  } finally {
    server.stop(true)
    await rm(directory, { recursive: true, force: true })
  }
}

test("provider filenames reject path separators, device names and control characters", () => {
  for (const provider of ["../escape", "..\\escape", "/absolute", "C:stream", "..", "", "nul", "CON.txt", "bad\0id", "bad\nid"]) {
    expect(() => providerIconFilename(provider)).toThrow("Invalid provider icon identifier")
  }
  expect(providerIconFilename("OpenAI-v2.0_test")).toBe("OpenAI-v2.0_test.svg")
})

test("a valid HTTP catalog writes exact SVG files inside the chosen directory", async () => {
  await withCatalog({ "acme-1": {}, OpenAI: {}, "a.b": {} }, async ({ url, output, requests }) => {
    await fetchProviderIcons(url, output)
    expect((await readdir(output)).sort()).toEqual(["OpenAI.svg", "a.b.svg", "acme-1.svg"])
    expect(await readFile(join(output, "acme-1.svg"), "utf8")).toBe(SVG)
    expect(requests.sort()).toEqual(["/api.json", "/logos/OpenAI.svg", "/logos/a.b.svg", "/logos/acme-1.svg"])
  })
})

test("the Vite development and build hooks await the actual HTTP and filesystem pipeline", async () => {
  await withCatalog({ valid: {} }, async ({ url, output, requests }) => {
    const plugin = providerIconsPlugin(url, output)
    for (const hook of [plugin.configureServer, plugin.buildStart]) {
      const refreshed = hook()
      expect(refreshed).toBeInstanceOf(Promise)
      await refreshed
      expect(await readFile(join(output, "valid.svg"), "utf8")).toBe(SVG)
    }
    expect(requests).toEqual(["/api.json", "/logos/valid.svg", "/api.json", "/logos/valid.svg"])
  })
})

test("a later malicious catalog key prevents every icon download and file write", async () => {
  await withCatalog({ valid: {}, "../../../../escape": {} }, async ({ url, output, requests }) => {
    await expect(fetchProviderIcons(url, output)).rejects.toThrow("Invalid provider icon identifier")
    expect(requests).toEqual(["/api.json"])
    expect(await readdir(output)).toEqual([])
  })
})

test("an array catalog is rejected without downloading icons", async () => {
  await withCatalog(["valid"], async ({ url, output, requests }) => {
    await expect(fetchProviderIcons(url, output)).rejects.toThrow("Provider catalog must be an object")
    expect(requests).toEqual(["/api.json"])
    expect(await readdir(output)).toEqual([])
  })
})

test("failed catalog and icon responses are reported instead of written as assets", async () => {
  await withCatalog({ valid: {} }, async ({ url, output }) => {
    await expect(fetchProviderIcons(url, output)).rejects.toThrow("Provider catalog request failed: 503")
    expect(await readdir(output)).toEqual([])
  }, { catalogStatus: 503 })
  await withCatalog({ valid: {} }, async ({ url, output }) => {
    await expect(fetchProviderIcons(url, output)).rejects.toThrow("Provider icon request failed: 503")
    expect(await readdir(output)).toEqual([])
  }, { iconStatus: 503 })
})
