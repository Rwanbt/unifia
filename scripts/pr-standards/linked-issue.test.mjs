/* SPDX-License-Identifier: MIT */
/**
 * Tests of the linked-issue rule: which pull requests count as linked, and which do not.
 * Run with `node --test scripts/pr-standards/`.
 */
import { describe, test } from "node:test"
import assert from "node:assert/strict"
import {
  closingReferences,
  isExemptTitle,
  resolveLinkedIssue,
} from "./linked-issue.mjs"

const REPOSITORY = "Rwanbt/unifia"
const DEFAULT_BRANCH = "main"
const INTEGRATION_BRANCH = "dev"

/** A lookup over a fixed set of issues: numbers map to `{ isPullRequest }`. Anything else is missing. */
function lookupIn(issues, calls = []) {
  return async (number) => {
    calls.push(number)
    return Object.hasOwn(issues, number) ? issues[number] : null
  }
}

function linked(overrides) {
  return resolveLinkedIssue({
    closingIssuesCount: 0,
    baseRef: INTEGRATION_BRANCH,
    defaultBranch: DEFAULT_BRANCH,
    body: "",
    repository: REPOSITORY,
    lookupIssue: lookupIn({ 450: { isPullRequest: false } }),
    ...overrides,
  })
}

describe("isExemptTitle", () => {
  test("keeps the exemptions of docs, refactor and feat", () => {
    assert.equal(isExemptTitle("docs: update the guide"), true)
    assert.equal(isExemptTitle("refactor(app): split the palette"), true)
    assert.equal(isExemptTitle("feat (server): add a route"), true)
  })

  test("does not exempt fix, chore, test, or a title that only contains the word", () => {
    assert.equal(isExemptTitle("fix(release): embed the interface"), false)
    assert.equal(isExemptTitle("chore: bump a dependency"), false)
    assert.equal(isExemptTitle("test: cover the rule"), false)
    assert.equal(isExemptTitle("the feature: not a prefix"), false)
  })
})

describe("closingReferences", () => {
  test("reads the three closing keywords, in any case and tense", () => {
    const numbers = (body) => closingReferences(body).map((reference) => reference.number)
    assert.deepEqual(numbers("Closes #450"), [450])
    assert.deepEqual(numbers("fixed #12 and RESOLVES #13"), [12, 13])
    assert.deepEqual(numbers("Close #1, fix #2, resolved #3"), [1, 2, 3])
  })

  test("reads a reference to another repository, and keeps its owner and name", () => {
    assert.deepEqual(closingReferences("Closes Rwanbt/unifia#7"), [{ owner: "Rwanbt", repo: "unifia", number: 7 }])
  })

  test("reads nothing from code, fenced or inline", () => {
    assert.deepEqual(closingReferences("`Closes #450`"), [])
    assert.deepEqual(closingReferences("```\nCloses #450\n```"), [])
  })

  test("reads nothing for refs, related or see, or for a keyword without a number", () => {
    assert.deepEqual(closingReferences("Refs #450"), [])
    assert.deepEqual(closingReferences("Related to #450"), [])
    assert.deepEqual(closingReferences("See #450"), [])
    assert.deepEqual(closingReferences("Closes #"), [])
    assert.deepEqual(closingReferences("Closes the bug"), [])
  })

  test("requires whitespace between the keyword and the reference", () => {
    assert.deepEqual(closingReferences("Closes#450"), [])
  })

  test("accepts an empty or missing description", () => {
    assert.deepEqual(closingReferences(null), [])
    assert.deepEqual(closingReferences(undefined), [])
    assert.deepEqual(closingReferences(""), [])
  })
})

describe("resolveLinkedIssue: positive cases", () => {
  test("a pull request into dev with a Closes keyword to an existing issue is linked", async () => {
    const result = await linked({ body: "### Issue\n\nCloses #450." })
    assert.deepEqual(result, { linked: true, source: "description", issue: 450 })
  })

  test("Fixes and Resolves are accepted as well as Closes", async () => {
    assert.equal((await linked({ body: "Fixes #450" })).linked, true)
    assert.equal((await linked({ body: "resolves #450" })).linked, true)
  })

  test("a reference to this repository by its full name is accepted", async () => {
    assert.equal((await linked({ body: "Closes Rwanbt/unifia#450" })).linked, true)
    assert.equal((await linked({ body: "closes rwanbt/UNIFIA#450" })).linked, true)
  })

  test("one valid keyword is enough when another reference in the description is invalid", async () => {
    const result = await linked({ body: "Closes #999 and Closes #450", lookupIssue: lookupIn({ 450: { isPullRequest: false } }) })
    assert.deepEqual(result, { linked: true, source: "description", issue: 450 })
  })

  test("GitHub's own closing reference is authoritative, whatever the description says", async () => {
    const calls = []
    const result = await linked({ closingIssuesCount: 1, body: "", lookupIssue: lookupIn({}, calls) })
    assert.deepEqual(result, { linked: true, source: "github" })
    assert.deepEqual(calls, [], "no lookup is needed when GitHub already links the pull request")
  })
})

describe("resolveLinkedIssue: negative cases", () => {
  test("no keyword means no link", async () => {
    assert.equal((await linked({ body: "Refs #450" })).linked, false)
    assert.equal((await linked({ body: "" })).linked, false)
  })

  test("a keyword whose issue does not exist does not link", async () => {
    assert.equal((await linked({ body: "Closes #999" })).linked, false)
  })

  test("a keyword whose number is a pull request does not link", async () => {
    const result = await linked({ body: "Closes #451", lookupIssue: lookupIn({ 451: { isPullRequest: true } }) })
    assert.equal(result.linked, false)
  })

  test("a reference to another repository does not link, and is not looked up here", async () => {
    const calls = []
    const result = await linked({ body: "Closes other/repo#450", lookupIssue: lookupIn({ 450: { isPullRequest: false } }, calls) })
    assert.equal(result.linked, false)
    assert.deepEqual(calls, [])
  })

  test("a keyword quoted in code does not link", async () => {
    assert.equal((await linked({ body: "Use `Closes #450` in the description" })).linked, false)
  })

  test("the default branch does not read the description: GitHub is the only source there", async () => {
    const calls = []
    const result = await linked({ baseRef: DEFAULT_BRANCH, body: "Closes #450", lookupIssue: lookupIn({ 450: { isPullRequest: false } }, calls) })
    assert.equal(result.linked, false)
    assert.deepEqual(calls, [])
  })

  test("a zero issue number is refused without a lookup", async () => {
    const calls = []
    const result = await linked({ body: "Closes #0", lookupIssue: lookupIn({}, calls) })
    assert.equal(result.linked, false)
    assert.deepEqual(calls, [])
  })

  test("a lookup that fails for another reason propagates, so the check fails instead of passing", async () => {
    const failing = async () => {
      throw new Error("HTTP 500")
    }
    await assert.rejects(linked({ body: "Closes #450", lookupIssue: failing }), /HTTP 500/)
  })
})
