/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { MAX_CHARS, MAX_LIST_ITEMS, SpeechSegmenter, type SpeechSegment } from "./speech-segmenter"

/** Behavioural port of the reference suite
 * `packages/voice-host/tests/test_live_text.py::SegmenterTests`. The
 * cross-runtime fixture (`speech-text-parity.test.ts`) proves byte parity;
 * these tests document intent so a drift is readable, not just a diff. */
function run(deltas: string[]): SpeechSegment[] {
  const segmenter = new SpeechSegmenter()
  const out: SpeechSegment[] = []
  for (const delta of deltas) out.push(...segmenter.push(delta))
  out.push(...segmenter.flush())
  return out
}

describe("SpeechSegmenter", () => {
  test("releases the first sentence before the answer ends", () => {
    const segmenter = new SpeechSegmenter()
    expect(segmenter.push("Sure")).toEqual([])
    expect(segmenter.push(".")).toEqual([]) // "Sure." could still become "Sure.Something"
    const released = segmenter.push(" Let me check")
    expect(released.map((segment) => segment.text)).toEqual(["Sure."])
  })

  test("segments follow sentence boundaries, not character counts", () => {
    const segments = run([
      "I fixed the failing test in the parser module. ",
      "It was an off-by-one error in the loop. Done.",
    ])
    expect(segments.map((segment) => segment.text)).toEqual([
      "I fixed the failing test in the parser module.",
      "It was an off-by-one error in the loop. Done.",
    ])
  })

  test("decimals, versions and abbreviations do not split", () => {
    const segments = run(["Version 3.5 uses about 2.4 GB, e.g. on Linux. That is fine."])
    expect(segments[0]?.text).toBe("Version 3.5 uses about 2.4 GB, e.g. on Linux.")
  })

  test("single-letter titles do not split mid-name", () => {
    const segments = run(["Merci M", ". Dupont pour votre aide.", " À bientôt."])
    expect(segments.map((segment) => segment.text)).toEqual(["Merci M. Dupont pour votre aide.", "À bientôt."])
  })

  test("a code fence becomes one marker and its body is never prose", () => {
    const segments = run(["Here is the fix:\n```ts\nconst a = 1\n", "console.log(a)\n```\nIt works now."])
    expect(segments.filter((segment) => segment.kind === "code")).toHaveLength(1)
    expect(segments.map((segment) => segment.text).join(" ")).not.toContain("console.log")
    expect(segments.at(-1)?.text).toBe("It works now.")
  })

  test("long lists are summarised after the fifth item", () => {
    const items = Array.from({ length: 9 }, (_value, index) => `- item number ${index}\n`).join("")
    const segments = run(["Changes:\n", items, "End."])
    const proseItems = segments.filter((segment) => segment.kind === "prose" && segment.text.startsWith("- item"))
    expect(proseItems).toHaveLength(MAX_LIST_ITEMS)
    const rest = segments.filter((segment) => segment.kind === "list_rest")
    expect(rest).toHaveLength(1)
    expect(rest[0]?.count).toBe(9 - MAX_LIST_ITEMS)
  })

  test("a list of exactly the maximum keeps every item and reports nothing", () => {
    const items = Array.from({ length: MAX_LIST_ITEMS }, (_value, index) => `- point ${index}\n`).join("")
    const segments = run(["Liste :\n", items, "Fin de la liste."])
    expect(segments.filter((segment) => segment.kind === "list_rest")).toHaveLength(0)
    expect(segments.filter((segment) => segment.text.startsWith("- point"))).toHaveLength(MAX_LIST_ITEMS)
  })

  test("tables are reported once", () => {
    const segments = run(["| a | b |\n|---|---|\n| 1 | 2 |\nAfter the table."])
    expect(segments.filter((segment) => segment.kind === "table")).toHaveLength(1)
  })

  test("a paragraph break releases the buffered prose", () => {
    const segments = run(["Un premier paragraphe assez long.", "\n\n", "Deuxième paragraphe qui suit."])
    expect(segments.map((segment) => segment.text)).toEqual([
      "Un premier paragraphe assez long.",
      "Deuxième paragraphe qui suit.",
    ])
  })

  test("an endless run is cut at a clause, never above the character ceiling", () => {
    const text = `${"word ".repeat(30)}, ${"more ".repeat(40)}`
    const segments = run([text])
    expect(segments.every((segment) => segment.text.length <= MAX_CHARS)).toBe(true)
    expect(segments.length).toBeGreaterThan(1)
  })

  test("an empty stream flushes nothing", () => {
    expect(run([])).toEqual([])
    expect(run(["   ", "  \t "])).toEqual([])
  })
})
