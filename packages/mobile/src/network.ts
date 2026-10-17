// The Android WebView origin is local to the APK. All remote API requests therefore use
// Tauri's native HTTP transport rather than depending on CORS headers at the PC.
// Plain HTTP is restricted to loopback (e.g. `adb reverse` during development).
export function routeFetch(
  browserFetch: typeof fetch,
  nativeFetch: typeof fetch,
  origin: string,
): typeof fetch {
  const request = (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = input instanceof Request ? input.url : input.toString()
    const url = new URL(raw, origin)

    // App drafts and attachments use data: and blob: URLs; never forward them
    // to the privileged native HTTP plugin or reject valid local attachments.
    if (url.origin === origin || url.protocol === "data:") return browserFetch(input, init)

    // Tauri's HTTP plugin does not forward the standard fetch `redirect` option
    // to Rust. Limit native redirects explicitly, otherwise a server could
    // redirect an authenticated request to a different origin with its token.
    const options: RequestInit & { maxRedirections: number; danger?: undefined; proxy?: undefined } = {
      ...init,
      redirect: "error",
      maxRedirections: 0,
      // Refuse Tauri-only options that could disable TLS verification or route
      // authenticated requests through a caller-selected proxy.
      danger: undefined,
      proxy: undefined,
    }

    if (url.protocol === "https:") return nativeFetch(input, options)

    if (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      return nativeFetch(input, options)
    }

    return Promise.reject(new TypeError("Remote servers must use HTTPS (or loopback HTTP for USB testing)"))
  }

  // Bun extends fetch with preconnect(); preserve that API when present while
  // keeping the transport usable in Android's ordinary WebView fetch runtime.
  return Object.assign(request, { preconnect: browserFetch.preconnect }) as typeof fetch
}
