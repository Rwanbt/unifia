/* SPDX-License-Identifier: MIT */
// Builds real ustar/pax archives in memory so the reader is tested against
// the byte layout apk-tools produces, not against a mock of the reader.
import { gzipSync } from "node:zlib"

export interface FixtureEntry {
  readonly name: string
  readonly type?: "0" | "2" | "1" | "5" | "3" | "x" | "L"
  readonly data?: string | Uint8Array
  readonly linkname?: string
  readonly mode?: number
}

const BLOCK = 512

const octal = (value: number, width: number) => value.toString(8).padStart(width - 1, "0") + "\0"

function header(entry: FixtureEntry, size: number): Uint8Array {
  const block = new Uint8Array(BLOCK)
  const put = (offset: number, text: string) => block.set(new TextEncoder().encode(text), offset)
  put(0, entry.name.slice(0, 100))
  put(100, octal(entry.mode ?? 0o644, 8))
  put(108, octal(0, 8))
  put(116, octal(0, 8))
  put(124, octal(size, 12))
  put(136, octal(0, 12))
  put(148, "        ")
  put(156, entry.type ?? "0")
  put(157, (entry.linkname ?? "").slice(0, 100))
  put(257, "ustar\0")
  put(263, "00")
  const sum = block.reduce((total, byte) => total + byte, 0)
  put(148, octal(sum, 7) + " ")
  return block
}

// The pax length prefix counts bytes, so a UTF-8 value makes it differ from the string length.
export function paxRecord(key: string, value: string): string {
  const body = ` ${key}=${value}\n`
  const bytes = (text: string) => new TextEncoder().encode(text).length
  let length = bytes(body) + 1
  while (bytes(`${length}${body}`) !== length) length = bytes(`${length}${body}`)
  return `${length}${body}`
}

export function tar(entries: readonly FixtureEntry[], endBlocks = true): Uint8Array {
  const parts: Uint8Array[] = []
  for (const entry of entries) {
    const data = typeof entry.data === "string" ? new TextEncoder().encode(entry.data) : (entry.data ?? new Uint8Array())
    parts.push(header(entry, data.length), data, new Uint8Array((BLOCK - (data.length % BLOCK)) % BLOCK))
  }
  if (endBlocks) parts.push(new Uint8Array(BLOCK * 2))
  return concat(...parts)
}

export const gzip = (data: Uint8Array) => new Uint8Array(gzipSync(data))

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}
