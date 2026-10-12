/* SPDX-License-Identifier: MIT */
/**
 * The conflict apply is a commit too: it changes the vault under the write lock, and it is fenced like every other commit. A lock taken
 * over after the apply has started is refused before the apply's next change, and nothing it would have changed is changed.
 */

import { describe, it, expect } from "bun:test"
import { existsSync, writeFileSync } from "node:fs"
import { hostname } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { applyConflict } from "../../../src/knowledge/admin/conflict-apply.js"
import { listConflicts, planConflict } from "../../../src/knowledge/admin/conflicts.js"
import { TMP_SUFFIX } from "../../../src/knowledge/mutation/durability.js"
import { LOCK_FILE } from "../../../src/knowledge/mutation/writer.js"
import { MAX_PID } from "../../../src/knowledge/mutation/lock-record.js"
import { bytesOf, crashedUpdate, openWriter } from "./conflict-fixture.js"

/** The lock is taken over: its file names another holder, which is gone (a dead pid on this host). */
function takeOver(root: string): void {
  writeFileSync(
    join(root, LOCK_FILE),
    JSON.stringify({
      v: 2,
      owner: randomUUID(),
      pid: MAX_PID,
      start: null,
      boot: null,
      host: hostname(),
      epoch: 99,
      at: new Date().toISOString(),
    }),
  )
}

describe("a conflict apply is fenced on the write lock", () => {
  it("a lock taken over after the apply started is refused before the next change, and nothing is changed", () => {
    const crash = crashedUpdate()
    const writer = openWriter(crash.root)
    const id = listConflicts(crash.root)[0]?.id as string
    planConflict(crash.root, { id, keep: "pending" })

    expect(() =>
      applyConflict(writer, crash.root, {
        id,
        hooks: {
          afterStep: (step) => {
            if (step === "started") takeOver(crash.root)
          },
        },
      }),
    ).toThrow(/did not finish/)

    // Nothing was changed: the owner's edit is still the note, the pending bytes are still in the temporary, and nothing was preserved.
    expect(bytesOf(join(crash.root, "n.md"))).toEqual(Buffer.from(crash.edit))
    expect(existsSync(join(crash.root, `n.md${TMP_SUFFIX}`))).toBe(true)
    expect(listConflicts(crash.root).map((c) => c.id)).toEqual([id])

    // The next open takes over the dead holder's lock, and the apply finishes as it does after any interruption at 'started'.
    const reopened = openWriter(crash.root)
    expect(applyConflict(reopened, crash.root, { id }).outcome).toBe("applied")
    expect(bytesOf(join(crash.root, "n.md"))).toEqual(Buffer.from(crash.pending))
    expect(listConflicts(crash.root)).toEqual([])
  })
})
