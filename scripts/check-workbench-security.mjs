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
  if (!contents[name].includes("object-src 'none'")) throw new Error(`${name} is missing object-src none`)
}
console.log("WorkbenchSecurityGuard: explicit origins, no wildcard credentials, object-src none")
