import { describe, expect, test } from "bun:test"
import { normalizeTeamSelection, teamModelKey, validateTeamSelection, type TeamSelection } from "@/context/team-selection"

const models = [
  { providerID: "one", modelID: "first" },
  { providerID: "two", modelID: "second" },
]
const available = new Set(models.map(teamModelKey))
const selection: TeamSelection = { models }

// The SPA fallback answers an unknown `/team/config` with HTTP 200 and this body,
// which the SDK surfaces as a plain string in `data`.
const SPA_FALLBACK_BODY = '<!doctype html>\n<html lang="en"><body><div id="root"></div></body></html>'

describe("normalizeTeamSelection", () => {
  test("returns undefined for an absent selection", () => {
    expect(normalizeTeamSelection(undefined)).toBeUndefined()
    expect(normalizeTeamSelection(null)).toBeUndefined()
  })

  test("returns undefined for the SPA fallback HTML served by a stale sidecar", () => {
    expect(normalizeTeamSelection(SPA_FALLBACK_BODY)).toBeUndefined()
  })

  test("returns undefined when models is missing or not an array", () => {
    expect(normalizeTeamSelection({})).toBeUndefined()
    expect(normalizeTeamSelection({ models: undefined })).toBeUndefined()
    expect(normalizeTeamSelection({ models: "two" })).toBeUndefined()
  })

  test("returns undefined when a model lacks providerID or modelID", () => {
    expect(normalizeTeamSelection({ models: [{ providerID: "one" }] })).toBeUndefined()
    expect(normalizeTeamSelection({ models: [{ modelID: "first" }] })).toBeUndefined()
    expect(normalizeTeamSelection({ models: [{ providerID: "", modelID: "first" }] })).toBeUndefined()
    expect(normalizeTeamSelection({ models: [null] })).toBeUndefined()
  })

  test("accepts a valid selection and strips unknown fields", () => {
    expect(normalizeTeamSelection({ models: [{ providerID: "one", modelID: "first", extra: 1 }] })).toEqual({
      models: [{ providerID: "one", modelID: "first" }],
    })
  })

  test("accepts an empty model list so the caller can decide it is not configured yet", () => {
    expect(normalizeTeamSelection({ models: [] })).toEqual({ models: [] })
  })
})

describe("validateTeamSelection", () => {
  test("accepts two distinct available models", () => {
    expect(validateTeamSelection(selection, available)).toBe(true)
  })

  test("rejects fewer than two models", () => {
    expect(validateTeamSelection(undefined, available)).toBe(false)
    expect(validateTeamSelection({ models: [] }, available)).toBe(false)
    expect(validateTeamSelection({ models: models.slice(0, 1) }, available)).toBe(false)
  })

  test("rejects duplicates", () => {
    expect(validateTeamSelection({ models: [models[0], models[0]] }, available)).toBe(false)
  })

  test("rejects models that disappeared from the connected catalog", () => {
    expect(validateTeamSelection({ models: [models[0], { providerID: "gone", modelID: "model" }] }, available)).toBe(
      false,
    )
  })

  test("does not throw when handed a malformed selection", () => {
    expect(validateTeamSelection({} as TeamSelection, available)).toBe(false)
    expect(validateTeamSelection(SPA_FALLBACK_BODY as unknown as TeamSelection, available)).toBe(false)
  })
})
