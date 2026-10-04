/* SPDX-License-Identifier: MIT */

export function parsePairingLink(raw: string) {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return
  }
  const command = parsed.hostname || parsed.pathname.replace(/^\/+/, "")
  if (parsed.protocol !== "unifia:" || command !== "connect") return
  const url = parsed.searchParams.get("url")
  if (!url) return
  try {
    const target = new URL(url)
    if (target.protocol !== "http:" && target.protocol !== "https:") return
  } catch {
    return
  }
  const username = parsed.searchParams.get("user") ?? "unifia"
  const password = parsed.searchParams.get("pwd") ?? ""
  if (username.length > 128 || password.length > 512) return
  const fingerprint = parsed.searchParams.get("fp")
  return {
    http: { url, username, password },
    // Only accept the SHA-256 format emitted by desktop tls.rs.
    fingerprint: fingerprint && /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/.test(fingerprint) ? fingerprint : null,
  }
}
