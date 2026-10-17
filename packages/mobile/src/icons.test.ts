import { test, expect } from "bun:test"
import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { join } from "node:path"

const mobile = join(import.meta.dir, "..")
const canonical = join(mobile, "..", "desktop", "icons", "prod")
const icons = join(mobile, "src-tauri", "icons")
const android = join(mobile, "src-tauri", "gen", "android", "app", "src", "main", "res")
const digest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex")

test("Tauri uses the canonical official OpenCode production icon", () => {
  expect(digest(join(icons, "icon.png"))).toBe(digest(join(canonical, "icon.png")))
})

test("all launcher density and adaptive resources match canonical Android assets", () => {
  const resources = ["mipmap-anydpi-v26/ic_launcher.xml", "values/ic_launcher_background.xml"]
  for (const density of ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"]) {
    for (const name of ["ic_launcher.png", "ic_launcher_foreground.png", "ic_launcher_round.png"]) {
      resources.push(`mipmap-${density}/${name}`)
    }
  }
  for (const rel of resources) {
    const parts = rel.split("/")
    const expected = digest(join(canonical, "android", ...parts))
    expect(digest(join(icons, "android", ...parts))).toBe(expected)
    expect(digest(join(android, ...parts))).toBe(expected)
  }
})
