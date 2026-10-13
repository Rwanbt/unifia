/* SPDX-License-Identifier: MIT */

import assert from "node:assert/strict"
import test from "node:test"
import { validateWiringManifest } from "./check-package-wiring.mjs"

const all = ["@unifia/app", "@unifia/runtime"]
const reached = new Set(["@unifia/app"])

test("accepts a deferred runtime only when it names a tracking issue", () => {
  const result = validateWiringManifest(
    {
      shippedRoots: ["@unifia/app"],
      notShipped: [
        {
          package: "@unifia/runtime",
          reason: "Deferred until its production consumer is wired.",
          classification: "deferred-runtime",
          trackingIssue: 123,
        },
      ],
    },
    all,
    reached,
  )
  assert.deepEqual(result.problems, [])
})

test("rejects an untracked deferred runtime", () => {
  const result = validateWiringManifest(
    {
      shippedRoots: ["@unifia/app"],
      notShipped: [
        {
          package: "@unifia/runtime",
          reason: "Deferred.",
          classification: "deferred-runtime",
        },
      ],
    },
    all,
    reached,
  )
  assert.ok(result.problems.some((problem) => problem.includes("trackingIssue")))
})

test("rejects an unknown classification", () => {
  const result = validateWiringManifest(
    {
      shippedRoots: ["@unifia/app"],
      notShipped: [
        {
          package: "@unifia/runtime",
          reason: "Deferred.",
          classification: "mystery",
        },
      ],
    },
    all,
    reached,
  )
  assert.ok(result.problems.some((problem) => problem.includes("classification")))
})

test("rejects a package that is both shipped and declared not shipped", () => {
  const result = validateWiringManifest(
    {
      shippedRoots: ["@unifia/app"],
      notShipped: [
        {
          package: "@unifia/app",
          reason: "Impossible state.",
          classification: "tooling",
        },
        {
          package: "@unifia/runtime",
          reason: "Tool-only.",
          classification: "tooling",
        },
      ],
    },
    all,
    reached,
  )
  assert.ok(result.problems.some((problem) => problem.includes("still listed as not shipped")))
})
