import { fetch as nativeFetch } from "@tauri-apps/plugin-http"
import { routeFetch } from "./network"

globalThis.fetch = routeFetch(globalThis.fetch.bind(globalThis), nativeFetch, location.origin)

// The official Web app owns every pixel, route and interaction. This APK provides
// transport and a native window, not a second UI or an on-device execution engine.
await import("../../app/src/entry")
