/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { automateNavSections } from "./automate-nav-sections"

const t = (key: string) => key
const base = { files: [], selected: undefined, runs: [], onOpenWorkflow: () => undefined, onOpenRuns: () => undefined }

describe("automateNavSections", () => {
  test("NoWorkflowFiles_HasNoRowsAndAnEmptyLine", () => {
    const [workflows] = automateNavSections(base, t)
    expect(workflows!.rows).toEqual([])
    expect(workflows!.emptyKey).toBe("workbench.automate.noDefinitions")
  })

  test("WorkflowFiles_ListTheirNamesAndMarkTheOpenOne", () => {
    const files = [".unifia/workflows/a.json", ".unifia/workflows/b.json"]
    const [workflows] = automateNavSections({ ...base, files, selected: ".unifia/workflows/b.draft-20260101.json" }, t)
    expect(workflows!.rows.map((row) => [row.label, row.active])).toEqual([
      ["a", false],
      ["b", true],
    ])
  })

  test("SelectingARow_OpensThatWorkflow", () => {
    const opened: string[] = []
    const [workflows] = automateNavSections({ ...base, files: ["x.json"], onOpenWorkflow: (path) => opened.push(path) }, t)
    workflows!.rows[0]!.onSelect?.()
    expect(opened).toEqual(["x.json"])
  })

  test("Runs_CountRealRunsAndFailures", () => {
    const runs = [{ status: "completed" }, { status: "failed" }, { status: "failed" }]
    const runsSection = automateNavSections({ ...base, runs }, t)[1]!
    expect(runsSection.count).toBe(3)
    expect(runsSection.rows.map((row) => row.badge)).toEqual(["3", "2"])
  })
})
