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
  const resources: string[] = []
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

test("adaptive icon preserves the full logo inside the Android mask safe zone", () => {
  const adaptive = "mipmap-anydpi-v26/ic_launcher.xml"
  const inset = "drawable/ic_launcher_foreground_inset.xml"
  const background = "values/ic_launcher_background.xml"
  for (const rel of [adaptive, inset, background]) {
    expect(digest(join(icons, "android", rel))).toBe(digest(join(android, rel)))
  }
  const foreground = readFileSync(join(android, inset), "utf8")
  expect(readFileSync(join(android, adaptive), "utf8")).toContain("@drawable/ic_launcher_foreground_inset")
  expect(foreground).toContain('@mipmap/ic_launcher_foreground')
  for (const side of ["Left", "Top", "Right", "Bottom"]) {
    expect(foreground).toContain(`android:inset${side}="22dp"`)
  }
  expect(readFileSync(join(android, background), "utf8")).toContain("#202020")
})
