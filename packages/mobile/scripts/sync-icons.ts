import { copyFileSync, mkdirSync, writeFileSync } from "node:fs"
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

// Adaptive icons show only the central 72dp of the 108dp foreground. The
// desktop foreground fills all 108dp, so launchers zoom/crop its outer frame.
// Inset its *unchanged official artwork* by 22dp on each side (64dp of art
// in the 72dp safe zone). The matte must be dark, since transparent margins
// over the desktop icon's white adaptive background would produce a white halo.
const overlays = {
  "mipmap-anydpi-v26/ic_launcher.xml": `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <foreground android:drawable="@drawable/ic_launcher_foreground_inset"/>
  <background android:drawable="@color/ic_launcher_background"/>
</adaptive-icon>
`,
  "drawable/ic_launcher_foreground_inset.xml": `<?xml version="1.0" encoding="utf-8"?>
<inset xmlns:android="http://schemas.android.com/apk/res/android"
  android:drawable="@mipmap/ic_launcher_foreground"
  android:insetLeft="22dp"
  android:insetTop="22dp"
  android:insetRight="22dp"
  android:insetBottom="22dp"/>
`,
  "values/ic_launcher_background.xml": `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <color name="ic_launcher_background">#202020</color>
</resources>
`,
}

for (const [rel, contents] of Object.entries(overlays)) {
  for (const root of [join(icons, "android"), res]) {
    const dest = join(root, rel)
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, contents)
  }
}

console.log("Android launcher art synchronized with centered, safe-zone-sized adaptive icon")
