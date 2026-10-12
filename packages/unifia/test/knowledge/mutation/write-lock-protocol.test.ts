/* SPDX-License-Identifier: MIT */
/**
 * The write-lock protocol, in one process: what a lock file records, what a holder's identity is judged by, and which locks are
 * reclaimed. A lock is reclaimed only when its holder is known to be gone, and never because it is old.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs"
import { tmpdir, hostname } from "node:os"
import { join } from "node:path"
import { WriteLock } from "../../../src/knowledge/mutation/durability.js"
import { LOCK_FILE } from "../../../src/knowledge/mutation/writer.js"
import { posixPlatform, linuxBootId, linuxStartTime } from "../../../src/knowledge/mutation/lock-platform-posix.js"
import { parseLock, MAX_PID } from "../../../src/knowledge/mutation/lock-record.js"
import { KnowledgeFailure } from "../../../src/knowledge/domain/errors.js"

/** A pid no process holds: the kernel answers ESRCH for it on every platform. */
const DEAD_PID = MAX_PID
const LINUX = process.platform === "linux"
/** An age far past any value a test could mean. Nothing is judged by age; this only dates a planted file. */
const OLD = new Date(Date.now() - 60 * 60_000)

describe("write lock protocol", () => {
  let root: string
  let path: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "unifia-protocol-"))
    mkdirSync(join(root, ".unifia"), { recursive: true })
    path = join(root, LOCK_FILE)
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  function plant(text: string, mtime?: Date): void {
    writeFileSync(path, text)
    if (mtime !== undefined) utimesSync(path, mtime, mtime)
  }

  function recordOnDisk(): Record<string, unknown> {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>
  }

  describe("what a lock records", () => {
    it("names its owner, process, start time, boot, host, epoch and time", () => {
      const lock = new WriteLock(path)
      lock.acquire()
      const record = recordOnDisk()
      lock.release()

      expect(record.v).toBe(2)
      expect(record.owner).toMatch(/^[0-9a-f-]{36}$/)
      expect(record.pid).toBe(process.pid)
      expect(record.host).toBe(hostname())
      expect(record.epoch).toBeGreaterThanOrEqual(1)
      expect(typeof record.at).toBe("string")
      if (LINUX) {
        expect(record.start).toBe(linuxStartTime(process.pid))
        expect(record.boot).toBe(linuxBootId())
      }
    })

    it("gives each acquisition a new owner", () => {
      const first = new WriteLock(path)
      first.acquire()
      const owner = recordOnDisk().owner
      first.release()

      const second = new WriteLock(path)
      second.acquire()
      expect(recordOnDisk().owner).not.toBe(owner)
      second.release()
    })
  })

  describe("legacy locks", () => {
    it("reclaims a legacy lock whose holder is dead, as before", () => {
      plant(JSON.stringify({ pid: DEAD_PID, at: "2020-01-01T00:00:00Z" }))
      const lock = new WriteLock(path)
      expect(lock.acquire().reclaimed).toBe(true)
      lock.release()
      expect(existsSync(path)).toBe(false)
    })

    it("refuses a legacy lock whose holder is alive, and keeps it", () => {
      plant(JSON.stringify({ pid: process.pid, at: "2020-01-01T00:00:00Z" }), OLD)
      expect(() => new WriteLock(path).acquire()).toThrow(/locked by another writer/)
      expect(readFileSync(path, "utf8")).toContain(String(process.pid))
    })
  })

  describe("a lock is never judged by its age", () => {
    it("refuses an empty lock file, however old, and keeps it", () => {
      // What a writer that died between creating the lock and writing its record leaves; a live writer can be in the same state.
      plant("", OLD)
      expect(() => new WriteLock(path).acquire()).toThrow(/locked by another writer/)
      expect(existsSync(path)).toBe(true)
    })

    it("refuses a lock whose format version is unknown, however old, and keeps it", () => {
      plant(JSON.stringify({ v: 3, owner: "x", pid: DEAD_PID, host: hostname(), epoch: 1, at: "2020-01-01T00:00:00Z" }), OLD)
      expect(() => new WriteLock(path).acquire()).toThrow(/locked by another writer/)
      expect(existsSync(path)).toBe(true)
    })

    it("refuses a lock whose pid is not a pid, however old, and keeps it", () => {
      plant(JSON.stringify({ pid: "123", at: "2020-01-01T00:00:00Z" }), OLD)
      expect(() => new WriteLock(path).acquire()).toThrow(/locked by another writer/)
      expect(existsSync(path)).toBe(true)
    })

    it("refuses a lock that is not an object, however old, and keeps it", () => {
      plant("[]", OLD)
      expect(() => new WriteLock(path).acquire()).toThrow(/locked by another writer/)
      expect(existsSync(path)).toBe(true)
    })

    it("names no path in the refusal", () => {
      plant("", OLD)
      let failure: unknown
      try {
        new WriteLock(path).acquire()
      } catch (e) {
        failure = e
      }
      expect(failure).toBeInstanceOf(KnowledgeFailure)
      expect((failure as Error).message).not.toContain(root)
      expect((failure as Error).message).not.toContain(LOCK_FILE)
    })
  })

  describe("another host", () => {
    it("refuses a lock another host holds, though its pid is dead here, and keeps it", () => {
      plant(
        JSON.stringify({
          v: 2,
          owner: "0f0f0f0f-0000-4000-8000-000000000001",
          pid: DEAD_PID,
          start: null,
          boot: null,
          host: "another-machine.invalid",
          epoch: 4,
          at: "2020-01-01T00:00:00Z",
        }),
        OLD,
      )
      expect(() => new WriteLock(path).acquire()).toThrow(/locked by another writer/)
      expect(parseLock(readFileSync(path, "utf8")).kind).toBe("record")
    })
  })

  describe("process identity", () => {
    it.skipIf(!LINUX)("reclaims a lock whose pid now belongs to another process, the start time having changed", () => {
      // Our own pid, alive, recorded with a start time that is not ours: the number was reused.
      plant(
        JSON.stringify({
          v: 2,
          owner: "0f0f0f0f-0000-4000-8000-000000000002",
          pid: process.pid,
          start: "1",
          boot: linuxBootId(),
          host: hostname(),
          epoch: 4,
          at: "2020-01-01T00:00:00Z",
        }),
      )
      const lock = new WriteLock(path)
      expect(lock.acquire().reclaimed).toBe(true)
      lock.release()
    })

    it.skipIf(!LINUX)("reclaims a lock from an earlier boot, though its pid is alive here", () => {
      plant(
        JSON.stringify({
          v: 2,
          owner: "0f0f0f0f-0000-4000-8000-000000000003",
          pid: process.pid,
          start: linuxStartTime(process.pid),
          boot: "00000000-0000-4000-8000-000000000000",
          host: hostname(),
          epoch: 4,
          at: "2020-01-01T00:00:00Z",
        }),
      )
      const lock = new WriteLock(path)
      expect(lock.acquire().reclaimed).toBe(true)
      lock.release()
    })

    it("holds a lock whose start time this platform cannot check, while its pid lives", () => {
      plant(
        JSON.stringify({
          v: 2,
          owner: "0f0f0f0f-0000-4000-8000-000000000004",
          pid: process.pid,
          start: "1",
          boot: null,
          host: hostname(),
          epoch: 4,
          at: "2020-01-01T00:00:00Z",
        }),
      )
      const unchecked = { ...posixPlatform, startTimeOf: () => null }
      expect(() => new WriteLock(path, {}, { platform: unchecked }).acquire()).toThrow(/locked by another writer/)
      expect(existsSync(path)).toBe(true)
    })
  })

  describe("reclaim guard", () => {
    const guard = () => `${path}.reclaim`
    const liveRecord = (owner: string) =>
      JSON.stringify({
        v: 2,
        owner,
        pid: process.pid,
        start: posixPlatform.startTimeOf(process.pid),
        boot: posixPlatform.bootId(),
        host: hostname(),
        epoch: 0,
        at: new Date().toISOString(),
      })

    it("a dead holder's lock is removed under the guard, and the guard is gone afterwards", () => {
      plant(JSON.stringify({ pid: DEAD_PID, at: "2020-01-01T00:00:00Z" }))
      const lock = new WriteLock(path)
      expect(lock.acquire().reclaimed).toBe(true)
      expect(existsSync(guard())).toBe(false)
      lock.release()
    })

    it("refuses a reclaim while another reclaimer holds the guard, and removes nothing", () => {
      plant(JSON.stringify({ pid: DEAD_PID, at: "2020-01-01T00:00:00Z" }))
      writeFileSync(guard(), liveRecord("0f0f0f0f-0000-4000-8000-0000000000aa"))
      expect(() => new WriteLock(path).acquire()).toThrow(/locked by another writer/)
      expect(readFileSync(path, "utf8")).toContain(String(DEAD_PID))
      expect(existsSync(guard())).toBe(true)
    })

    it("refuses a reclaim behind a guard whose holder is dead, and does not remove the guard", () => {
      // A reclaimer that died between judging and removing. Removing its guard here would reopen the window the guard closes.
      plant(JSON.stringify({ pid: DEAD_PID, at: "2020-01-01T00:00:00Z" }))
      writeFileSync(
        guard(),
        JSON.stringify({
          v: 2,
          owner: "0f0f0f0f-0000-4000-8000-0000000000bb",
          pid: DEAD_PID,
          start: null,
          boot: null,
          host: hostname(),
          epoch: 0,
          at: "2020-01-01T00:00:00Z",
        }),
      )
      let failure: unknown
      try {
        new WriteLock(path).acquire()
      } catch (e) {
        failure = e
      }
      expect(failure).toBeInstanceOf(KnowledgeFailure)
      expect((failure as Error).message).toMatch(/locked by another writer/)
      expect(existsSync(guard())).toBe(true)
      expect(existsSync(path)).toBe(true)
    })

    it("refuses a reclaim behind a guard that cannot be read, and removes nothing", () => {
      plant(JSON.stringify({ pid: DEAD_PID, at: "2020-01-01T00:00:00Z" }))
      writeFileSync(guard(), "not a record")
      expect(() => new WriteLock(path).acquire()).toThrow(/locked by another writer/)
      expect(existsSync(guard())).toBe(true)
      expect(existsSync(path)).toBe(true)
    })
  })

  describe("platform adapter (POSIX)", () => {
    it("never writes over an existing entry, and never follows a dangling link", () => {
      const target = join(root, "outside-target")
      symlinkSync(target, path)
      expect(posixPlatform.createExclusive(path, "{}")).toBe("exists")
      // The create did not follow the link to its target.
      expect(existsSync(target)).toBe(false)
      expect(lstatSync(path).isSymbolicLink()).toBe(true)
    })

    it("creates a file that is not there, and reports when there is none to remove", () => {
      expect(posixPlatform.createExclusive(path, "{}")).toBe("created")
      expect(readFileSync(path, "utf8")).toBe("{}")
      expect(posixPlatform.removeFile(path)).toBe(true)
      expect(posixPlatform.removeFile(path)).toBe(false)
    })

    it("replaces a file in one step, leaving no temporary behind", () => {
      writeFileSync(path, "old")
      posixPlatform.replaceAtomic(path, "new")
      expect(readFileSync(path, "utf8")).toBe("new")
      expect(readdirTemporaries(root)).toEqual([])
    })
  })

  describe("platform adapter (Windows), not run here", () => {
    // Written from the documented semantics and not executed in this environment: no result is claimed for it.
    it.skipIf(process.platform !== "win32")("refuses a symbolic link at the lock path before the exclusive create", async () => {
      const { win32Platform } = await import("../../../src/knowledge/mutation/lock-platform-win32.js")
      const target = join(root, "outside-target")
      symlinkSync(target, path)
      expect(win32Platform.createExclusive(path, "{}")).toBe("exists")
      expect(existsSync(target)).toBe(false)
    })
  })
})

function readdirTemporaries(dir: string): string[] {
  return readdirSync(join(dir, ".unifia")).filter((name) => name.endsWith(".lock-tmp"))
}
