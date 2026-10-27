/* SPDX-License-Identifier: MIT */
// Reads Alpine `.apk` packages: concatenated gzip members (signature,
// control, data), each holding a ustar/pax stream. Extraction goes into a
// fresh staging directory and treats every archive byte as hostile, because
// the archive is only trusted after the caller has checked its signature and
// digest — and this module must stay safe even if that check is skipped.
import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { crc32, inflateRawSync } from "node:zlib"

export class ArchiveError extends Error {
  override name = "ArchiveError"
}

export interface GzipMember {
  // Exact bytes of the member: signatures are computed over these.
  readonly compressed: Uint8Array
  readonly decompressed: Uint8Array
}

export type TarEntryType = "file" | "directory" | "symlink" | "hardlink"

export interface TarEntry {
  readonly path: string
  readonly type: TarEntryType
  readonly mode: number
  readonly data: Uint8Array
  readonly linkTarget?: string
}

export interface ExtractedFile {
  readonly path: string
  readonly type: TarEntryType
  readonly sha256?: string
}

const BLOCK = 512
const GZIP_HEADER_FLAGS = { extra: 4, name: 8, comment: 16, headerCrc: 2 } as const
const PERMISSION_BITS = 0o777
const TYPE_BY_FLAG: Record<string, TarEntryType> = { "0": "file", "\0": "file", "7": "file", "5": "directory", "2": "symlink", "1": "hardlink" }

function skipZeroTerminated(bytes: Uint8Array, offset: number): number {
  const nul = bytes.indexOf(0, offset)
  return nul === -1 ? bytes.length : nul + 1
}

function deflateStart(bytes: Uint8Array, offset: number): number {
  if (bytes[offset] !== 0x1f || bytes[offset + 1] !== 0x8b || bytes[offset + 2] !== 8) {
    throw new ArchiveError(`no gzip member at byte ${offset}`)
  }
  const flags = bytes[offset + 3]!
  let cursor = offset + 10
  if (flags & GZIP_HEADER_FLAGS.extra) cursor += 2 + (bytes[cursor]! | (bytes[cursor + 1]! << 8))
  if (flags & GZIP_HEADER_FLAGS.name) cursor = skipZeroTerminated(bytes, cursor)
  if (flags & GZIP_HEADER_FLAGS.comment) cursor = skipZeroTerminated(bytes, cursor)
  if (flags & GZIP_HEADER_FLAGS.headerCrc) cursor += 2
  return cursor
}

export function splitGzipMembers(bytes: Uint8Array): GzipMember[] {
  const members: GzipMember[] = []
  let offset = 0
  while (offset < bytes.length) {
    const start = deflateStart(bytes, offset)
    let inflated: { buffer: Uint8Array; engine: { bytesWritten: number } }
    try {
      inflated = inflateRawSync(bytes.subarray(start), { info: true }) as unknown as typeof inflated
    } catch (cause) {
      throw new ArchiveError(`corrupt gzip member at byte ${offset}: ${String(cause)}`)
    }
    const end = start + inflated.engine.bytesWritten + 8 // + CRC32 and ISIZE trailer
    if (end > bytes.length) throw new ArchiveError(`truncated gzip member at byte ${offset}`)
    // inflate does not read the trailer; corrupted deflate data can still decode.
    const trailer = new DataView(bytes.buffer, bytes.byteOffset + end - 8, 8)
    if (trailer.getUint32(0, true) !== crc32(inflated.buffer) || trailer.getUint32(4, true) !== inflated.buffer.length % 2 ** 32) {
      throw new ArchiveError(`gzip member at byte ${offset} fails its CRC32 or size check`)
    }
    members.push({ compressed: bytes.subarray(offset, end), decompressed: new Uint8Array(inflated.buffer) })
    offset = end
  }
  return members
}

function field(block: Uint8Array, offset: number, length: number): string {
  const raw = block.subarray(offset, offset + length)
  const nul = raw.indexOf(0)
  return new TextDecoder().decode(nul === -1 ? raw : raw.subarray(0, nul))
}

function octalField(block: Uint8Array, offset: number, length: number): number {
  const text = field(block, offset, length).trim()
  if (text === "") return 0
  if (!/^[0-7]+$/.test(text)) throw new ArchiveError(`invalid octal field "${text}"`)
  return Number.parseInt(text, 8)
}

function verifyChecksum(block: Uint8Array) {
  let sum = 0
  for (let index = 0; index < BLOCK; index++) sum += index >= 148 && index < 156 ? 0x20 : block[index]!
  if (sum !== octalField(block, 148, 8)) throw new ArchiveError("tar header checksum mismatch")
}

// Record lengths count bytes: decode each record only after slicing it.
function parsePax(data: Uint8Array): Map<string, string> {
  const records = new Map<string, string>()
  let cursor = 0
  while (cursor < data.length) {
    const space = data.indexOf(0x20, cursor)
    const length = Number(new TextDecoder().decode(data.subarray(cursor, space)))
    if (space === -1 || !Number.isInteger(length) || length <= space - cursor) throw new ArchiveError("malformed pax record")
    const record = new TextDecoder().decode(data.subarray(space + 1, cursor + length - 1))
    const equals = record.indexOf("=")
    if (equals === -1) throw new ArchiveError("malformed pax record")
    records.set(record.slice(0, equals), record.slice(equals + 1))
    cursor += length
  }
  return records
}

export function readTar(bytes: Uint8Array): TarEntry[] {
  const entries: TarEntry[] = []
  let pending = new Map<string, string>()
  let offset = 0
  while (offset + BLOCK <= bytes.length) {
    const block = bytes.subarray(offset, offset + BLOCK)
    if (block.every((byte) => byte === 0)) break
    verifyChecksum(block)
    const size = octalField(block, 124, 12)
    const data = bytes.subarray(offset + BLOCK, offset + BLOCK + size)
    if (data.length !== size) throw new ArchiveError("truncated tar member")
    offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK
    const flag = field(block, 156, 1) || "\0"
    if (flag === "x") {
      pending = parsePax(data)
      continue
    }
    if (flag === "L" || flag === "K") {
      pending.set(flag === "L" ? "path" : "linkpath", field(data, 0, data.length))
      continue
    }
    const type = TYPE_BY_FLAG[flag]
    if (!type) throw new ArchiveError(`unsupported tar entry type "${flag}"`)
    const prefix = field(block, 345, 155)
    const name = pending.get("path") ?? (prefix ? `${prefix}/${field(block, 0, 100)}` : field(block, 0, 100))
    const linkTarget = pending.get("linkpath") ?? field(block, 157, 100)
    pending = new Map()
    entries.push({
      path: safeRelativePath(name),
      type,
      mode: octalField(block, 100, 8) & PERMISSION_BITS,
      data: type === "file" ? data : new Uint8Array(),
      ...(type === "symlink" || type === "hardlink" ? { linkTarget } : {}),
    })
  }
  return entries
}

export function safeRelativePath(raw: string): string {
  if (raw.includes("\0")) throw new ArchiveError("path contains NUL")
  if (raw.startsWith("/")) throw new ArchiveError(`absolute path "${raw}"`)
  const parts = raw.split("/").filter((part) => part !== "" && part !== ".")
  if (parts.length === 0) throw new ArchiveError("empty path")
  if (parts.includes("..")) throw new ArchiveError(`parent reference in "${raw}"`)
  return parts.join("/")
}

// Every ancestor must be a real directory created by this extraction: a
// symlink planted by an earlier member could otherwise redirect a write
// outside the staging root.
function ensureParents(root: string, relative: string) {
  let current = root
  for (const part of relative.split("/").slice(0, -1)) {
    current = path.join(current, part)
    const stat = fs.lstatSync(current, { throwIfNoEntry: false })
    if (!stat) fs.mkdirSync(current, { mode: 0o755 })
    else if (stat.isSymbolicLink()) throw new ArchiveError(`refusing to write through symlink "${part}"`)
    else if (!stat.isDirectory()) throw new ArchiveError(`"${part}" is not a directory`)
  }
}

export function extractEntries(entries: readonly TarEntry[], root: string): ExtractedFile[] {
  if (fs.readdirSync(root).length > 0) throw new ArchiveError("extraction root must be empty")
  const contents = new Map<string, Uint8Array>()
  const seen = new Set<string>()
  const written: ExtractedFile[] = []
  for (const entry of entries) {
    if (seen.has(entry.path)) throw new ArchiveError(`duplicate member "${entry.path}"`)
    seen.add(entry.path)
    ensureParents(root, entry.path)
    const target = path.join(root, entry.path)
    if (entry.type === "directory" || entry.type === "symlink") {
      if (entry.type === "symlink") fs.symlinkSync(entry.linkTarget!, target)
      else if (!fs.existsSync(target)) fs.mkdirSync(target, { mode: entry.mode | 0o700 })
      written.push({ path: entry.path, type: entry.type })
      continue
    }
    // SELinux denies link() for app data on Android, so hardlinks become copies.
    const data = entry.type === "hardlink" ? contents.get(safeRelativePath(entry.linkTarget!)) : entry.data
    if (!data) throw new ArchiveError(`hardlink "${entry.path}" targets a member outside the archive`)
    fs.writeFileSync(target, data, { flag: "wx", mode: entry.mode })
    fs.chmodSync(target, entry.mode)
    contents.set(entry.path, data)
    written.push({ path: entry.path, type: "file", sha256: createHash("sha256").update(data).digest("hex") })
  }
  return written
}
