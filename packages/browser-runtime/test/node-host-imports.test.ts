/* SPDX-License-Identifier: MIT */
import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { readdirSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

/**
 * Bun maps the `.js` specifiers inside `@unifia/contracts` onto its `.ts`
 * sources and Node does not, so a module the Node Browser host loads can pass
 * every Bun test and typecheck and still fail under Node (#408). These tests
 * load the real modules in a Node child process, the way the host loads them.
 */
const node = process.env.UNIFIA_NODE_PATH ?? "node"
const nodeAvailable = spawnSync(node, ["--version"]).status === 0
const packageDir = join(import.meta.dir, "..")
const hostEntry = join(packageDir, "src/host/host-entry.ts")
const sourceRoots = [join(packageDir, "src"), join(packageDir, "../network-authority/src")]

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts") ? [path] : []
  })
}

function runNode(script: string, args: readonly string[]): string {
  const run = spawnSync(node, ["--experimental-strip-types", "--input-type=module", "-e", script, ...args], {
    cwd: packageDir,
    encoding: "utf8",
    timeout: 60_000,
  })
  const line = run.stdout.split("\n").filter((text) => text.startsWith("RESULT ")).pop()
  if (run.status !== 0 || line === undefined) throw new Error(`node exited ${run.status}: ${run.stderr}`)
  return line.slice("RESULT ".length)
}

// Imports each module by URL and reports the failures, first line of each error.
const loadEach = `
const failures = []
for (const url of JSON.parse(process.argv[1])) {
  try { await import(url) } catch (error) { failures.push(url + " :: " + String(error.message).split("\\n")[0]) }
}
console.log("RESULT " + JSON.stringify(failures))
`

test.skipIf(!nodeAvailable)("every module the Node Browser host loads imports under Node", () => {
  // host-entry runs the host when imported; host-client-node.test.ts boots it over real pipes.
  const urls = sourceRoots
    .flatMap(sourceFiles)
    .filter((file) => file !== hostEntry)
    .map((file) => pathToFileURL(file).href)
  expect(urls.some((url) => url.endsWith("/network-authority/src/authority.ts"))).toBe(true)
  expect(urls.some((url) => url.endsWith("/browser-runtime/src/host/host-main.ts"))).toBe(true)
  expect(JSON.parse(runNode(loadEach, [JSON.stringify(urls)]))).toEqual([])
}, 120_000)

test.skipIf(!nodeAvailable)("the egress proxy a first tab open starts loads and listens under Node", () => {
  const address = runNode(
    `
const { BrowserEgressProxy } = await import("@unifia/network-authority")
const proxy = new BrowserEgressProxy({ policy: () => ({ allowedOrigins: [], blockThirdPartyCookies: true, defaultDeny: true }), onDenied() {} })
const started = await proxy.start()
await proxy.close()
console.log("RESULT " + JSON.stringify(started))
`,
    [],
  )
  expect(JSON.parse(address)).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
}, 60_000)
