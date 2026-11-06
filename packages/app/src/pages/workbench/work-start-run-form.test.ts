/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import {
  emptyDraftBudget,
  emptyDraftTask,
  parseList,
  shownDraftErrors,
  startRunErrorMessage,
  teamModelsReady,
  toStartRunPayload,
  validateDraft,
  validateBudget,
  type DraftTask,
} from "./work-start-run-form"

const task = (overrides: Partial<DraftTask> = {}): DraftTask => ({ ...emptyDraftTask(), ...overrides })

describe("WorkBudget_Validation_RespectsServerConstraints", () => {
  test("accepts omitted values, fractional cost and integer boundaries", () => {
    for (const budget of [emptyDraftBudget(), { maxCostUsd: "0.01", maxTokens: "1", maxParallel: "50" }]) {
      expect(validateBudget(budget)).toEqual([])
    }
  })

  test("rejects non-finite, zero, negative and malformed values in each field", () => {
    for (const field of ["maxCostUsd", "maxTokens", "maxParallel"] as const) {
      for (const value of ["NaN", "Infinity", "1e999", "0", "-1", "abc"]) {
        expect(validateBudget({ ...emptyDraftBudget(), [field]: value })).toEqual([{ kind: "invalidBudget", field }])
      }
    }
  })

  test("rejects fractional counts and parallelism above fifty", () => {
    expect(validateBudget({ maxCostUsd: "1.5", maxTokens: "1.5", maxParallel: "51" })).toEqual([
      { kind: "invalidBudget", field: "maxTokens" },
      { kind: "invalidBudget", field: "maxParallel" },
    ])
    expect(validateBudget({ ...emptyDraftBudget(), maxParallel: "1.5" })).toEqual([{ kind: "invalidBudget", field: "maxParallel" }])
    expect(validateBudget({ ...emptyDraftBudget(), maxTokens: "9007199254740992" })).toEqual([
      { kind: "invalidBudget", field: "maxTokens" },
    ])
  })

  test("refuses to serialize invalid budgets even outside the dialog", () => {
    expect(() => toStartRunPayload("objective", { ...emptyDraftBudget(), maxTokens: "-1" }, [])).toThrow(RangeError)
  })
})

describe("WorkDraft_UntouchedFields_HidesPrematureErrors", () => {
  test("keeps an empty draft invalid while hiding its initial errors", () => {
    const errors = validateDraft("", [emptyDraftTask()])
    expect(errors.length).toBeGreaterThan(0)
    expect(shownDraftErrors({ description: false, tasks: false }, errors)).toEqual([])
    expect(shownDraftErrors({ description: true, tasks: false }, errors)).toEqual([{ kind: "descriptionRequired" }])
    expect(shownDraftErrors({ description: true, tasks: true }, errors)).toEqual(errors)
  })
})

describe("teamModelsReady — the server's two-model floor", () => {
  const model = (providerID: string, modelID: string) => ({ providerID, modelID })

  test("refuses zero or one configured model", () => {
    expect(teamModelsReady([])).toBe(false)
    expect(teamModelsReady([model("p", "a")])).toBe(false)
  })

  test("refuses the same model twice", () => {
    expect(teamModelsReady([model("p", "a"), model("p", "a")])).toBe(false)
  })

  test("accepts two distinct configured models", () => {
    expect(teamModelsReady([model("p", "a"), model("p", "b")])).toBe(true)
  })
})

describe("startRunErrorMessage — surface the server's sentence", () => {
  test("keeps an Error message", () => {
    expect(startRunErrorMessage(new Error("workspace is not a git repository"))).toBe(
      "workspace is not a git repository",
    )
  })

  test("reads the SDK error object shape", () => {
    expect(startRunErrorMessage({ error: "Invalid Team task graph or Git workspace" })).toBe(
      "Invalid Team task graph or Git workspace",
    )
  })

  test("falls back to the caller's copy when no message exists", () => {
    expect(startRunErrorMessage({})).toBe("")
    expect(startRunErrorMessage(undefined)).toBe("")
  })
})

describe("parseList — comma-separated form fields", () => {
  test("trims and drops empty entries", () => {
    expect(parseList(" a, b ,, c ")).toEqual(["a", "b", "c"])
  })
  test("an empty string is an empty list", () => {
    expect(parseList("")).toEqual([])
  })
})

describe("validateDraft — the four server-side rules, reimplemented client-side", () => {
  const valid = task({ id: "t1", description: "d", prompt: "p", agent: "build" })

  test("a well-formed single task is valid", () => {
    expect(validateDraft("objective", [valid])).toEqual([])
  })

  test("an empty description is rejected", () => {
    expect(validateDraft("", [valid])).toContainEqual({ kind: "descriptionRequired" })
  })

  test("no tasks at all is rejected", () => {
    expect(validateDraft("objective", [])).toContainEqual({ kind: "noTasks" })
  })

  test("a task missing a required field is rejected", () => {
    const errors = validateDraft("objective", [task({ id: "t1", description: "", prompt: "p", agent: "build" })])
    expect(errors).toContainEqual({ kind: "missingFields", id: "t1" })
  })

  test("a duplicate task id is rejected", () => {
    const errors = validateDraft("objective", [valid, valid])
    expect(errors).toContainEqual({ kind: "duplicateId", id: "t1" })
  })

  test("a task depending on itself is rejected", () => {
    const errors = validateDraft("objective", [
      task({ id: "t1", description: "d", prompt: "p", agent: "build", dependsOn: "t1" }),
    ])
    expect(errors).toContainEqual({ kind: "selfDependency", id: "t1" })
  })

  test("a dependency on an id that doesn't exist in the draft is rejected", () => {
    const errors = validateDraft("objective", [
      task({ id: "t1", description: "d", prompt: "p", agent: "build", dependsOn: "ghost" }),
    ])
    expect(errors).toContainEqual({ kind: "unknownDependency", id: "t1", dependsOn: "ghost" })
  })

  test("a real dependency cycle is rejected", () => {
    const errors = validateDraft("objective", [
      task({ id: "t1", description: "d", prompt: "p", agent: "build", dependsOn: "t2" }),
      task({ id: "t2", description: "d", prompt: "p", agent: "build", dependsOn: "t1" }),
    ])
    expect(errors).toContainEqual({ kind: "cycle" })
  })

  test("a real, valid dependency chain is not flagged as a cycle", () => {
    const errors = validateDraft("objective", [
      task({ id: "t1", description: "d", prompt: "p", agent: "build" }),
      task({ id: "t2", description: "d", prompt: "p", agent: "build", dependsOn: "t1" }),
    ])
    expect(errors).toEqual([])
  })
})

describe("toStartRunPayload — the exact shape StartRunSchema expects", () => {
  test("drops empty optional fields rather than sending empty arrays/undefined budget", () => {
    const payload = toStartRunPayload("objective", emptyDraftBudget(), [
      task({ id: "t1", description: "d", prompt: "p", agent: "build" }),
    ])
    expect(payload).toEqual({
      description: "objective",
      tasks: [{ id: "t1", description: "d", prompt: "p", agent: "build", mode: "read" }],
    })
  })

  test("includes budget only when at least one field is set, as real numbers", () => {
    const payload = toStartRunPayload("objective", { maxCostUsd: "5", maxTokens: "", maxParallel: "" }, [
      task({ id: "t1", description: "d", prompt: "p", agent: "build" }),
    ])
    expect(payload.budget).toEqual({ maxCostUsd: 5, maxTokens: undefined, maxParallel: undefined })
  })

  test("parses dependsOn/readSet/writeSet into real arrays and keeps risk/modelIndex when set", () => {
    const payload = toStartRunPayload("objective", emptyDraftBudget(), [
      task({
        id: "t2",
        description: "d",
        prompt: "p",
        agent: "build",
        mode: "write",
        risk: "high",
        dependsOn: "t1",
        readSet: "a.ts, b.ts",
        writeSet: "c.ts",
        modelIndex: 1,
      }),
    ])
    expect(payload.tasks[0]).toEqual({
      id: "t2",
      description: "d",
      prompt: "p",
      agent: "build",
      mode: "write",
      risk: "high",
      dependsOn: ["t1"],
      readSet: ["a.ts", "b.ts"],
      writeSet: ["c.ts"],
      modelIndex: 1,
    })
  })
})

describe("validateDraft — optional budgets match the Team route schema (#976)", () => {
  const valid = task({ id: "t1", description: "d", prompt: "p", agent: "build" })
  const budget = (patch: Partial<ReturnType<typeof emptyDraftBudget>>) => ({ ...emptyDraftBudget(), ...patch })
  const invalidFields = (patch: Partial<ReturnType<typeof emptyDraftBudget>>) =>
    validateDraft("objective", [valid], budget(patch)).flatMap((error) => (error.kind === "invalidBudget" ? [error.field] : []))

  test("empty budget fields are optional", () => {
    expect(validateDraft("objective", [valid], emptyDraftBudget())).toEqual([])
  })

  test("cost must be finite and positive", () => {
    expect(invalidFields({ maxCostUsd: "0.01" })).toEqual([])
    for (const raw of ["0", "-1", "abc", "Infinity"]) expect(invalidFields({ maxCostUsd: raw })).toEqual(["maxCostUsd"])
  })

  test("tokens must be a positive integer", () => {
    expect(invalidFields({ maxTokens: "1" })).toEqual([])
    for (const raw of ["0", "1.5", "-3", "x"]) expect(invalidFields({ maxTokens: raw })).toEqual(["maxTokens"])
  })

  test("parallelism must be an integer from 1 to 50", () => {
    expect(invalidFields({ maxParallel: "1" })).toEqual([])
    expect(invalidFields({ maxParallel: "50" })).toEqual([])
    for (const raw of ["0", "51", "2.5"]) expect(invalidFields({ maxParallel: raw })).toEqual(["maxParallel"])
  })
})

describe("shownDraftErrors — a fresh form stays quiet until edited (#976)", () => {
  test("errors are hidden before the first edit and shown after", () => {
    const errors = validateDraft("", [emptyDraftTask()])
    expect(errors.length).toBeGreaterThan(0)
    expect(shownDraftErrors(false, errors)).toEqual([])
    expect(shownDraftErrors(true, errors)).toEqual(errors)
  })
})
