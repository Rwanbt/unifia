/* SPDX-License-Identifier: MIT */
/**
 * A write's place is judged where it really lands, through links, for the vault's own folder and for nested ones.
 *
 * A write is judged by its locator and by containment. A link on the way is followed for an existing place, but a dangling link
 * was judged by its own name, so a note created through one was refused only by accident (a name clash), and a conflict plan named
 * its new note's place through a link into a nested folder and was accepted, then refused halfway through its apply. Each case here
 * names the place a link really leads to, and checks that the refusal happens before anything is written.
 */

import { describe, it, expect } from "bun:test"
import { existsSync, mkdirSync, readFileSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import { applyConflict } from "../../../src/knowledge/admin/conflict-apply.js"
import { listConflicts, planConflict } from "../../../src/knowledge/admin/conflicts.js"
import { readDecisions } from "../../../src/knowledge/mutation/conflict-record.js"
import { crashedUpdate, freshVault, openWriter, refusalOf } from "./conflict-fixture.js"

const OPEN = { remoteModel: "deny", localModel: "allow", embeddable: "allow", exportable: "deny" } as const

function createIntent(locator: string) {
  return {
    kind: "create",
    targetLocator: locator,
    newContent: { type: "decision", restrictions: OPEN, body: "a body" },
    reason: "test",
    source: "test",
  }
}

function refusalOfCreate(writer: ReturnType<typeof openWriter>, locator: string): Promise<{ kind?: string; message: string }> {
  return writer
    .apply({ intent: createIntent(locator), reason: "test", source: "test" })
    .then(() => ({ message: "applied" }), (e: { kind?: string; message: string }) => e)
}

describe("a create through a dangling link is refused as a write into the vault's own folder", () => {
  it("a file link to a place inside the vault's own folder, which does not exist yet, refuses the create by its locator", async () => {
    const root = freshVault()
    mkdirSync(join(root, "notes"), { recursive: true })
    symlinkSync(join(root, ".unifia", "x.md"), join(root, "notes", "dangling.md"))
    const writer = openWriter(root)

    const refusal = await refusalOfCreate(writer, "notes/dangling.md")

    expect(refusal.kind).toBe("mutation_refused")
    expect(refusal.message).toContain("notes/dangling.md")
    expect(refusal.message).not.toContain(root)
    expect(existsSync(join(root, ".unifia", "x.md"))).toBe(false)
  })

  it("a folder link to a nested folder that does not exist yet refuses a create beneath it, by its locator", async () => {
    const root = freshVault()
    symlinkSync(join(root, "notes", ".unifia"), join(root, "alias"))
    const writer = openWriter(root)

    const refusal = await refusalOfCreate(writer, "alias/new.md")

    expect(refusal.kind).toBe("mutation_refused")
    expect(refusal.message).toContain("alias/new.md")
    expect(refusal.message).not.toContain(root)
    expect(existsSync(join(root, "notes"))).toBe(false)
  })
})

describe("a create through an existing link into a folder of the vault is refused", () => {
  it("a folder link to the vault's own folder refuses a create beneath it", async () => {
    const root = freshVault()
    symlinkSync(join(root, ".unifia"), join(root, "alias"))
    const refusal = await refusalOfCreate(openWriter(root), "alias/new.md")
    expect(refusal.kind).toBe("mutation_refused")
  })

  it("a folder link to a nested folder that exists refuses a create beneath it", async () => {
    const root = freshVault()
    mkdirSync(join(root, "notes", ".unifia"), { recursive: true })
    symlinkSync(join(root, "notes", ".unifia"), join(root, "alias"))
    const refusal = await refusalOfCreate(openWriter(root), "alias/new.md")
    expect(refusal.kind).toBe("mutation_refused")
    expect(existsSync(join(root, "notes", ".unifia", "new.md"))).toBe(false)
  })
})

describe("a keep-both plan does not name a new note's place inside a folder of the vault's own name", () => {
  function openedConflictWithNested() {
    const crash = crashedUpdate()
    mkdirSync(join(crash.root, "notes", ".unifia"), { recursive: true })
    const writer = openWriter(crash.root)
    const id = listConflicts(crash.root)[0]?.id as string
    return { ...crash, writer, id }
  }

  it("a place that reaches a nested folder through an existing link is refused at plan time, and nothing is recorded", () => {
    const { root, id } = openedConflictWithNested()
    symlinkSync(join(root, "notes", ".unifia"), join(root, "alias"))
    const before = readDecisions(root).length

    const refusal = refusalOf(() => planConflict(root, { id, keep: "both", as: "alias/y.md" }))

    expect(refusal.kind).toBe("mutation_refused")
    expect(refusal.message).not.toContain(root)
    expect(readDecisions(root).length).toBe(before)
  })

  it("a place that reaches the vault's own folder through a dangling link is refused at plan time", () => {
    const { root, id } = openedConflictWithNested()
    symlinkSync(join(root, ".unifia", "sub"), join(root, "ghost"))

    const refusal = refusalOf(() => planConflict(root, { id, keep: "both", as: "ghost/y.md" }))

    expect(refusal.kind).toBe("mutation_refused")
  })

  it("a plan made before a link appeared is refused at apply time, before any step of the apply is recorded", async () => {
    const { root, writer, id } = openedConflictWithNested()
    planConflict(root, { id, keep: "both", as: "later/y.md" })
    symlinkSync(join(root, "notes", ".unifia"), join(root, "later"))
    const decisionsBefore = readDecisions(root).length
    const edit = readFileSync(join(root, "n.md"), "utf8")

    const refusal = refusalOf(() => applyConflict(writer, root, { id }))

    expect(refusal.kind).toBe("mutation_refused")
    expect(readDecisions(root).length).toBe(decisionsBefore)
    expect(readFileSync(join(root, "n.md"), "utf8")).toBe(edit)
    expect(existsSync(join(root, "notes", ".unifia", "y.md"))).toBe(false)
  })

  it("an ordinary keep-both place is planned and applied as before", async () => {
    const { root, writer, id } = openedConflictWithNested()
    planConflict(root, { id, keep: "both", as: "kept/y.md" })

    const out = applyConflict(writer, root, { id })

    expect(out.newLocator).toBe("kept/y.md")
    expect(existsSync(join(root, "kept", "y.md"))).toBe(true)
  })
})
