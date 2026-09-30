/* SPDX-License-Identifier: MIT */
import { pbkdf2Sync, randomBytes } from "node:crypto"
import { chmodSync, closeSync, linkSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { homedir, hostname } from "node:os"
import { join } from "node:path"

import type { OwnershipScope } from "./index.js"

const PBKDF2_ITERATIONS = 100_000
const PBKDF2_KEYLEN = 32
const PBKDF2_DIGEST = "sha256"
const SALT_BYTES = 32
const SALT_TEMP_RANDOM_BYTES = 12
const SALT_TEMP_SUFFIX = ".tmp"
const STORE_DIRNAME = process.platform === "win32" ? "unifia/secret-broker" : ".unifia/secret-broker"
const SALT_FILENAME = "salt"
const KEK_FILENAME = "kek"

type EntryKind = "credential" | "secret" | "oauth" | "browser-profile"

export function resolveStorageDir(override: string | undefined): string {
  if (override) return override
  return join(homedir(), STORE_DIRNAME)
}

export function ensureDir(dir: string): void {
  if (!mkdirSync(dir, { recursive: true })) return
  try {
    chmodSync(dir, 0o700)
  } catch {
    // WHY: POSIX permissions do not apply on Windows or some filesystems.
  }
}

export function pathForEntry(storageDir: string, scope: OwnershipScope, kind: EntryKind, id: string): string {
  const safeScope = `${scope.organizationId}__${scope.workspaceId}`.replace(/[^A-Za-z0-9_.-]/g, "_")
  const safeId = id.replace(/[^A-Za-z0-9_.-]/g, "_")
  return join(storageDir, "entries", `${safeScope}__${kind}__${safeId}.json`)
}

function osPassphrase(platform: NodeJS.Platform): string {
  if (platform === "win32") return `${process.env.USERPROFILE ?? homedir()}\\${hostname()}`
  return `${homedir()}:${hostname()}`
}

function hasErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === code)
}

function ensureSalt(storageDir: string): Buffer {
  ensureDir(storageDir)
  const saltPath = join(storageDir, SALT_FILENAME)
  try {
    return readFileSync(saltPath)
  } catch (error) {
    if (!hasErrorCode(error, "ENOENT")) throw error
  }

  const salt = randomBytes(SALT_BYTES)
  const temporaryPath = join(storageDir, `${SALT_FILENAME}.${randomBytes(SALT_TEMP_RANDOM_BYTES).toString("hex")}${SALT_TEMP_SUFFIX}`)
  let temporaryCreated = false
  try {
    const descriptor = openSync(temporaryPath, "wx", 0o600)
    temporaryCreated = true
    try {
      writeFileSync(descriptor, salt)
    } finally {
      closeSync(descriptor)
    }
    // The same-directory hard link publishes a complete salt and refuses replacement.
    try {
      linkSync(temporaryPath, saltPath)
      return salt
    } catch (error) {
      if (!hasErrorCode(error, "EEXIST")) throw error
      return readFileSync(saltPath)
    }
  } finally {
    if (temporaryCreated) {
      try {
        unlinkSync(temporaryPath)
      } catch (error) {
        if (!hasErrorCode(error, "ENOENT")) throw error
      }
    }
  }
}

export function loadOsKek(storageDir: string, platform: NodeJS.Platform): Buffer {
  return pbkdf2Sync(osPassphrase(platform), ensureSalt(storageDir), PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST)
}

export function storeOsKek(storageDir: string): void {
  const kekPath = join(storageDir, KEK_FILENAME)
  try {
    writeFileSync(kekPath, new Uint8Array([0x01]), { flag: "wx", mode: 0o600 })
  } catch (error) {
    if (hasErrorCode(error, "EEXIST")) return
    throw error
  }
  try {
    chmodSync(kekPath, 0o600)
  } catch {
    // WHY: POSIX permissions do not apply on Windows or some filesystems.
  }
}
