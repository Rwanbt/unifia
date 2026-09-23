/* SPDX-License-Identifier: MIT */

// The Unifia app icon, served from packages/app/public, which the desktop
// builds (Tauri and Electron) also use as their publicDir. A local asset keeps
// the UI from fetching the brand image off a third-party site.
export const UNIFIA_ICON_PATH = "/brand/unifia/unifia-192.png"

// Absolute URL of the icon, for APIs that do not resolve relative URLs
// (the Notification constructor).
export const unifiaIconUrl = (base: string = window.location.href) => new URL(UNIFIA_ICON_PATH, base).href
