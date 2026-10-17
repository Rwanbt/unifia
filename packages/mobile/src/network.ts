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

    // Tauri's HTTP plugin does not forward the standard fetch `redirect` option
    // to Rust. Limit native redirects explicitly, otherwise a server could
    // redirect an authenticated request to a different origin with its token.
    const options: RequestInit & { maxRedirections: number } = {
      ...init,
      redirect: "error",
      maxRedirections: 0,
    }

    if (url.protocol === "https:") return nativeFetch(input, options)

    if (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      return nativeFetch(input, options)
    }

    return Promise.reject(new TypeError("Remote servers must use HTTPS (or loopback HTTP for USB testing)"))
  }
}
