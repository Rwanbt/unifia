import { readFile } from "node:fs/promises"

const files = {
  server: "packages/workbench-server/src/security.ts",
  desktop: "packages/desktop/src-tauri/tauri.conf.json",
  mobile: "packages/mobile/src-tauri/tauri.conf.json",
}
const contents = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, file]) => [key, await readFile(file, "utf8")])));
const requiredOrigins = ["https://tauri.localhost", "http://ipc.localhost"]

for (const origin of requiredOrigins) {
  for (const [name, source] of Object.entries(contents)) {
    if (!source.includes(origin)) throw new Error(`${name} is missing ${origin}`)
  }
}
if (/access-control-allow-origin["']?\s*[:=]\s*["']\*["']/i.test(contents.server)) throw new Error("server contains wildcard credential CORS")
for (const name of ["desktop", "mobile"]) {
  const config = JSON.parse(contents[name])
  const csp = config.app?.security?.csp
  if (typeof csp !== "string") throw new Error(`${name} has no extractable CSP`)
  const directives = new Map(csp.split(";").map((part) => {
    const tokens = part.trim().split(/\s+/)
    return [tokens[0], tokens.slice(1)]
  }))
  if (!directives.get("connect-src")?.includes("http://127.0.0.1:*")) throw new Error(`${name} is missing loopback connect-src`)
  if (!directives.get("img-src")?.includes("data:")) throw new Error(`${name} is missing data image source`)
  if (directives.get("object-src")?.join(" ") !== "'none'") throw new Error(`${name} has an unsafe object-src`)
  if (directives.get("frame-ancestors")?.join(" ") !== "'none'") throw new Error(`${name} has an unsafe frame-ancestors policy`)
}
console.log("WorkbenchSecurityGuard: source and packaged CSPs enforce explicit origins, data images, object-src none, frame-ancestors none")
