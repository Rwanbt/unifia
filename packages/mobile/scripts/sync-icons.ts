import { copyFileSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"

// OpenCode Desktop is the canonical source of production launcher artwork.
// Keep both Tauri's icon input and the generated Android Gradle resources in
// sync: Android may use adaptive mipmaps instead of the top-level icon.png.
const mobile = join(import.meta.dir, "..")
const upstream = join(mobile, "..", "desktop", "icons", "prod")
const icons = join(mobile, "src-tauri", "icons")
const res = join(mobile, "src-tauri", "gen", "android", "app", "src", "main", "res")

function sync(from: string, to: string) {
  mkdirSync(dirname(to), { recursive: true })
  copyFileSync(from, to)
}

sync(join(upstream, "icon.png"), join(icons, "icon.png"))

const mipmaps = ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"] as const
const names = ["ic_launcher.png", "ic_launcher_foreground.png", "ic_launcher_round.png"] as const

for (const density of mipmaps) {
  for (const name of names) {
    const rel = join(`mipmap-${density}`, name)
    const source = join(upstream, "android", rel)
    sync(source, join(icons, "android", rel))
    sync(source, join(res, rel))
  }
}

const adaptive = join("mipmap-anydpi-v26", "ic_launcher.xml")
sync(join(upstream, "android", adaptive), join(icons, "android", adaptive))
sync(join(upstream, "android", adaptive), join(res, adaptive))

// The official adaptive icon XML points to this named background color;
// omitting it makes AAPT reject the APK despite valid mipmap PNGs.
const background = join("values", "ic_launcher_background.xml")
sync(join(upstream, "android", background), join(icons, "android", background))
sync(join(upstream, "android", background), join(res, background))

console.log("Android launcher icons synchronized from canonical OpenCode Desktop production artwork")
