/* SPDX-License-Identifier: MIT */
import { Database } from "bun:sqlite"
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto"
import { chmodSync, mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { BrowserSessionSchema, type BrowserSession } from "@unifia/contracts/browser"
import type { BrowserSessionSnapshotStore, BrowserStorageState, BrowserStorageStateStore } from "@unifia/browser-runtime"

const FORMAT_VERSION = 1
const IV_BYTES = 12
const TAG_BYTES = 16
const MAX_SNAPSHOT_BYTES = 1024 * 1024
const MAX_STORAGE_BYTES = 4 * 1024 * 1024

/** Recovery state only; BrowserSessionService remains the live authority. */
export class BrowserSessionSqliteStore implements BrowserSessionSnapshotStore, BrowserStorageStateStore {
  readonly #db: Database
  readonly #key: Buffer
  readonly #keyId: string

  private constructor(db: Database, secret: string) {
    this.#db = db
    this.#key = Buffer.from(hkdfSync("sha256", Buffer.from(secret), "unifia-browser-sessions", "snapshot-v1", 32))
    this.#keyId = createHmac("sha256", this.#key).update("key-id").digest("hex")
  }

  static open(file: string, secret: string): BrowserSessionSqliteStore {
    if (!secret) throw new Error("browser session snapshot secret is required")
    const target = resolve(file)
    mkdirSync(dirname(target), { recursive: true })
    const db = new Database(target, { create: true })
    try {
      if (process.platform !== "win32") chmodSync(target, 0o600)
      db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000")
      db.exec("CREATE TABLE IF NOT EXISTS browser_sessions (key_id TEXT NOT NULL, id TEXT NOT NULL, payload BLOB NOT NULL, PRIMARY KEY (key_id, id))")
      db.exec("CREATE TABLE IF NOT EXISTS browser_storage (key_id TEXT NOT NULL, id TEXT NOT NULL, payload BLOB NOT NULL, PRIMARY KEY (key_id, id))")
      return new BrowserSessionSqliteStore(db, secret)
    } catch (error) {
      db.close()
      throw error
    }
  }

  load(): readonly BrowserSession[] {
    const rows = this.#db.query("SELECT id, payload FROM browser_sessions WHERE key_id = ?").all(this.#keyId) as Array<{ id: string; payload: Uint8Array }>
    const sessions: BrowserSession[] = []
    for (const row of rows) {
      try {
        const session = BrowserSessionSchema.parse(JSON.parse(this.#decrypt(row.payload).toString("utf8")))
        if (session.id !== row.id) throw new Error("browser session snapshot id mismatch")
        sessions.push(session)
      } catch {
        // WHY: decoder errors may embed decrypted URL data and must not enter logs.
        process.emitWarning("Invalid encrypted Browser session snapshot skipped", { code: "BROWSER_SNAPSHOT_INVALID" })
      }
    }
    return sessions
  }

  save(session: BrowserSession): void {
    const valid = BrowserSessionSchema.parse(session)
    if (valid.status === "closed") {
      this.#db.query("DELETE FROM browser_sessions WHERE key_id = ? AND id = ?").run(this.#keyId, valid.id)
      return
    }
    const plain = Buffer.from(JSON.stringify(valid))
    if (plain.byteLength > MAX_SNAPSHOT_BYTES) throw new Error("browser session snapshot exceeds size limit")
    const payload = this.#encrypt(plain)
    this.#db.query("INSERT INTO browser_sessions (key_id, id, payload) VALUES (?, ?, ?) ON CONFLICT(key_id, id) DO UPDATE SET payload = excluded.payload").run(this.#keyId, valid.id, payload)
  }

  loadStorage(sessionId: string): BrowserStorageState | undefined {
    const row = this.#db.query("SELECT payload FROM browser_storage WHERE key_id = ? AND id = ?").get(this.#keyId, sessionId) as { payload: Uint8Array } | null
    if (!row) return undefined
    try {
      const state: unknown = JSON.parse(this.#decrypt(row.payload).toString("utf8"))
      if (!state || typeof state !== "object" || !Array.isArray((state as BrowserStorageState).cookies) || !Array.isArray((state as BrowserStorageState).origins)) throw new Error("invalid Browser storage state")
      return state as BrowserStorageState
    } catch {
      process.emitWarning("Invalid encrypted Browser storage state skipped", { code: "BROWSER_STORAGE_INVALID" })
      return undefined
    }
  }

  saveStorage(sessionId: string, state: BrowserStorageState): void {
    const plain = Buffer.from(JSON.stringify(state))
    if (plain.byteLength > MAX_STORAGE_BYTES) throw new Error("browser storage state exceeds size limit")
    const payload = this.#encrypt(plain)
    this.#db.query("INSERT INTO browser_storage (key_id, id, payload) VALUES (?, ?, ?) ON CONFLICT(key_id, id) DO UPDATE SET payload = excluded.payload").run(this.#keyId, sessionId, payload)
  }

  deleteStorage(sessionId: string): void {
    this.#db.query("DELETE FROM browser_storage WHERE key_id = ? AND id = ?").run(this.#keyId, sessionId)
  }

  close(): void { this.#db.close() }

  #encrypt(plain: Buffer): Buffer {
    const iv = randomBytes(IV_BYTES)
    const cipher = createCipheriv("aes-256-gcm", this.#key, iv)
    return Buffer.concat([Buffer.from([FORMAT_VERSION]), iv, cipher.update(plain), cipher.final(), cipher.getAuthTag()])
  }

  #decrypt(payload: Uint8Array): Buffer {
    const bytes = Buffer.from(payload)
    if (bytes.byteLength < 1 + IV_BYTES + TAG_BYTES || bytes[0] !== FORMAT_VERSION) throw new Error("invalid browser session snapshot format")
    const decipher = createDecipheriv("aes-256-gcm", this.#key, bytes.subarray(1, 1 + IV_BYTES))
    decipher.setAuthTag(bytes.subarray(-TAG_BYTES))
    return Buffer.concat([decipher.update(bytes.subarray(1 + IV_BYTES, -TAG_BYTES)), decipher.final()])
  }
}
