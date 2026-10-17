// The Android WebView origin is local to the APK. All remote API requests therefore use
// Tauri's native HTTP transport rather than depending on CORS headers at the PC.
// Plain HTTP is restricted to loopback (e.g. `adb reverse` during development).
export function routeFetch(
  browserFetch: typeof fetch,
  nativeFetch: typeof fetch,
  origin: string,
): typeof fetch {
  return (input, init) => {
    const raw = input instanceof Request ? input.url : input.toString()
    const url = new URL(raw, origin)

    if (url.origin === origin) return browserFetch(input, init)

    if (url.protocol === "https:") return nativeFetch(input, init)

    if (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      return nativeFetch(input, init)
    }

    return Promise.reject(new TypeError("Remote servers must use HTTPS (or loopback HTTP for USB testing)"))
  }
}
