/* SPDX-License-Identifier: MIT */
/**
 * Which restriction governs a note for which audience.
 *
 * A model is held to the note's `local_model` or `remote_model` restriction. The owner is not
 * a model, so the model restrictions do not apply to the owner's view on this machine, and a
 * remote destination is never an owner view.
 */
import { describe, expect, test } from "bun:test"
import type { ProviderDestinationPlan } from "@unifia/contracts/knowledge"
import { restrictionFor } from "../../../src/knowledge/policy/audience"

const LOCAL_DENIED = { localModel: "deny", remoteModel: "allow" } as const
const REMOTE_DENIED = { localModel: "allow", remoteModel: "deny" } as const

function plan(overrides: Partial<ProviderDestinationPlan>): ProviderDestinationPlan {
  return { providerId: "p", defaultRestriction: "allow", ...overrides }
}

describe("restrictionFor", () => {
  test("a model on this machine is held to local_model", () => {
    expect(restrictionFor(LOCAL_DENIED, plan({ destinationKind: "local" }))).toBe("deny")
    expect(restrictionFor(REMOTE_DENIED, plan({ destinationKind: "local" }))).toBe("allow")
  })

  test("a remote model is held to remote_model", () => {
    expect(restrictionFor(REMOTE_DENIED, plan({ destinationKind: "remote" }))).toBe("deny")
    expect(restrictionFor(LOCAL_DENIED, plan({ destinationKind: "remote" }))).toBe("allow")
  })

  test("a plan that does not declare itself local is treated as remote", () => {
    expect(restrictionFor(REMOTE_DENIED, plan({}))).toBe("deny")
  })

  test("the owner on this machine is not held to either model restriction", () => {
    expect(restrictionFor(LOCAL_DENIED, plan({ destinationKind: "local", audience: "owner" }))).toBe("allow")
    expect(restrictionFor(REMOTE_DENIED, plan({ destinationKind: "local", audience: "owner" }))).toBe("allow")
  })

  test("an owner view that would leave the machine is refused by construction", () => {
    expect(restrictionFor(LOCAL_DENIED, plan({ destinationKind: "remote", audience: "owner" }))).toBe("deny")
    expect(restrictionFor(REMOTE_DENIED, plan({ destinationKind: "remote", audience: "owner" }))).toBe("deny")
    expect(restrictionFor(LOCAL_DENIED, plan({ audience: "owner" }))).toBe("deny")
  })

  test("an explicit model audience behaves like a missing one", () => {
    expect(restrictionFor(LOCAL_DENIED, plan({ destinationKind: "local", audience: "model" }))).toBe("deny")
  })
})
