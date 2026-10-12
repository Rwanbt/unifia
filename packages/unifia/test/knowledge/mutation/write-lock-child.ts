/* SPDX-License-Identifier: MIT */
/**
 * Helper for the write-lock protocol tests: one writer process, driven by a spec file.
 *
 * usage: bun write-lock-child.ts <spec.json>
 *
 * Modes:
 *  - `race`: for each round, wait for `go-<round>`, then open the vault and create one note. The child reports
 *    `applied`, `refused` or `error` in `out-<round>-<id>`.
 *  - `lock`: take the write lock directly, optionally pausing right after the reclaim's re-read (`pauseAfterReread`) or inside
 *    the critical section (`pauseInside`). A pause writes `at-<name>-<id>` and waits for `go-<name>-<id>`.
 *
 * Every critical section is bracketed by a marker in `cs/<id>`: a process that finds another marker while it holds the lock writes
 * a line to `violations`. The parent reads that file; a non-empty file means two writers were inside together.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { VaultMutationWriter, LOCK_FILE } from "../../../src/knowledge/mutation/writer.js"
import { WriteLock } from "../../../src/knowledge/mutation/durability.js"
import { KnowledgeFailure } from "../../../src/knowledge/domain/errors.js"

interface Spec {
  mode: "race" | "lock" | "write"
  root: string
  dir: string
  id: string
  rounds?: number
  pauseAfterReread?: boolean
  pauseInside?: boolean
  /** `write`: the mutation to apply, and the commit step at which this process kills itself with SIGKILL. */
  intent?: Record<string, unknown>
  killAt?: string
  /** `write`: a commit step at which this process waits for `go-<step>-<id>`, so the parent can act between two steps. */
  pauseAt?: string
}

const spec = JSON.parse(readFileSync(process.argv[2] ?? "", "utf8")) as Spec
const OPEN = { remoteModel: "deny", localModel: "allow", embeddable: "allow", exportable: "deny" } as const
const WAIT_LIMIT_MS = 60_000

function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function waitFor(path: string): void {
  let waited = 0
  while (!existsSync(path)) {
    sleepMs(1)
    waited += 1
    if (waited > WAIT_LIMIT_MS) process.exit(4)
  }
}

/**
 * Write a report the parent waits for. It is written under a temporary name and renamed into place, so the parent never reads a
 * report that exists but is still empty.
 */
function report(name: string, text: string): void {
  const target = join(spec.dir, name)
  writeFileSync(`${target}.tmp`, text)
  renameSync(`${target}.tmp`, target)
}

/** Touch `at-<name>-<id>`, then wait for `go-<name>-<id>`: the parent decides when this process moves on. */
function pause(name: string): void {
  writeFileSync(join(spec.dir, `at-${name}-${spec.id}`), "")
  waitFor(join(spec.dir, `go-${name}-${spec.id}`))
}

/** Mark this process as inside the critical section, and report another marker if one is there too. */
function enterCriticalSection(): void {
  const cs = join(spec.dir, "cs")
  mkdirSync(cs, { recursive: true })
  writeFileSync(join(cs, spec.id), "")
  const others = readdirSync(cs).filter((name) => name !== spec.id)
  if (others.length > 0) appendFileSync(join(spec.dir, "violations"), `${spec.id} entered while ${others.join(",")} was inside\n`)
  // Hold the section long enough for a second writer to be seen inside it if one got in.
  sleepMs(3)
}

function leaveCriticalSection(): void {
  unlinkSync(join(spec.dir, "cs", spec.id))
}

function outcomeOf(error: unknown): string {
  if (error instanceof KnowledgeFailure) return `refused ${error.message}`
  return `error ${(error as Error).message}`
}

async function runRace(): Promise<void> {
  for (let round = 0; round < (spec.rounds ?? 0); round += 1) {
    waitFor(join(spec.dir, `go-${round}`))
    let outcome: string
    try {
      // The constructor does not reconcile: the lock is taken by the commit itself, so the race is the commit's.
      const writer = new VaultMutationWriter({
        root: spec.root,
        recoverOnOpen: false,
        hooks: {
          atStep: (step) => {
            if (step === "lock-durable") enterCriticalSection()
            if (step === "previous-removed") leaveCriticalSection()
          },
        },
      })
      await writer.apply({
        intent: {
          kind: "create",
          targetLocator: `notes/r${round}-${spec.id}.md`,
          newContent: { type: "decision", restrictions: OPEN, body: `round ${round} from ${spec.id}` },
          reason: "race",
          source: `child-${spec.id}`,
        },
        reason: "race",
        source: `child-${spec.id}`,
      })
      outcome = "applied"
    } catch (error) {
      outcome = outcomeOf(error)
    }
    report(`out-${round}-${spec.id}`, outcome)
  }
}

function runLock(): void {
  const lockPath = join(spec.root, LOCK_FILE)
  const lock = new WriteLock(lockPath, {
    afterReread: spec.pauseAfterReread ? () => pause("reread") : undefined,
  })
  try {
    lock.acquire()
  } catch (error) {
    report(`out-${spec.id}`, outcomeOf(error))
    return
  }
  report(`out-${spec.id}`, "acquired")
  enterCriticalSection()
  if (spec.pauseInside) pause("inside")
  leaveCriticalSection()
  // A base without a release outcome returns nothing: reported as text, so the child reaches its own report either way.
  report(`release-${spec.id}`, String(lock.release()))
  report(`done-${spec.id}`, "")
}

/** One mutation, with a kill or a pause at a commit step. The outcome is reported like the other modes'. */
async function runWrite(): Promise<void> {
  if (spec.intent === undefined) process.exit(64)
  const writer = new VaultMutationWriter({
    root: spec.root,
    hooks: {
      atStep: (step) => {
        if (step === spec.killAt) process.kill(process.pid, "SIGKILL")
        if (step === spec.pauseAt) pause(step)
      },
    },
  })
  try {
    await writer.apply({ intent: spec.intent, reason: "child", source: `child-${spec.id}` })
    report(`out-${spec.id}`, "applied")
  } catch (error) {
    report(`out-${spec.id}`, outcomeOf(error))
  }
}

if (spec.mode === "race") await runRace()
else if (spec.mode === "write") await runWrite()
else runLock()
