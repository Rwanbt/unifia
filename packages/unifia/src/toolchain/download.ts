// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors

import { createHash } from "node:crypto"
import { rename } from "node:fs/promises"

const TIMEOUT_MS = 10 * 60 * 1000

export type Pin = { size: number; sha256?: string; sha512?: string }

// Streams `url` into `<dest>.part`, refusing more bytes than the pin allows while it streams. The
// size and the digests are checked at the end, and only a verified file is renamed to `dest`.
export async function download(url: string, dest: string, pin: Pin) {
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok || res.body === null) throw new Error(`download failed: HTTP ${res.status} for ${url}`)
  const part = `${dest}.part`
  const sink = Bun.file(part).writer()
  const sha256 = createHash("sha256")
  const sha512 = createHash("sha512")
  let bytes = 0
  const reader = res.body.getReader()
  try {
    let next = await reader.read()
    while (!next.done) {
      bytes += next.value.byteLength
      if (bytes > pin.size) throw new Error(`download exceeds the pinned size of ${pin.size} bytes`)
      sha256.update(next.value)
      sha512.update(next.value)
      sink.write(next.value)
      next = await reader.read()
    }
  } finally {
    await sink.end()
  }
  if (bytes !== pin.size) throw new Error(`size mismatch: got ${bytes} bytes, pinned ${pin.size}`)
  if (pin.sha256 !== undefined && sha256.digest("hex") !== pin.sha256) throw new Error("sha256 mismatch")
  if (pin.sha512 !== undefined && `sha512-${sha512.digest("base64")}` !== pin.sha512) {
    throw new Error("sha512 mismatch")
  }
  await rename(part, dest)
}
