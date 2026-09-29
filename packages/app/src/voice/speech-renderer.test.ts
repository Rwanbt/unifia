/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { speechLanguages } from "@unifia/contracts/speech"
import { phrase, PHRASES, redactSecrets, render, renderSegment } from "./speech-renderer"

/** Behavioural port of the reference suites
 * `packages/voice-host/tests/test_live_text.py::RendererTests` and
 * `tests/test_renderer_security.py` (the R14 security gate). The
 * cross-runtime fixture proves byte parity; these tests document the
 * invariant: Voice must never speak secrets. */

const UNSAFE_SAMPLES = [
  { secret: "sk-ant-abcdefghijklmnopqrstuvwxyz0123", forbidden: ["sk-ant"] },
  { secret: "ghp_abcdefghijklmnopqrstuvwxyz0123456789", forbidden: ["ghp_"] },
  { secret: "AKIAABCDEFGHIJKLMNOP", forbidden: ["AKIA"] },
  { secret: "password: hunter2hunter2", forbidden: ["hunter2"] },
  { secret: "Bearer abcdefghijklmnopqrstuvwxyz", forbidden: ["abcdefghijklmnopqrstuvwxyz"] },
  { secret: "https://user:pa55word@example.com/repo", forbidden: ["pa55word"] },
] as const

describe("SpeechRenderer", () => {
  test("secrets are never spoken", () => {
    for (const sample of UNSAFE_SAMPLES) {
      const spoken = render(`The value is ${sample.secret} now.`, "en") ?? ""
      expect(spoken).not.toContain(sample.secret)
      for (const fragment of sample.forbidden) expect(spoken).not.toContain(fragment)
    }
  })

  test("a private key block is redacted", () => {
    const text = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkq\n-----END PRIVATE KEY-----"
    expect(redactSecrets(text, "en")).not.toContain("MIIEvQ")
  })

  test("URLs, paths and hashes are reduced to speakable text", () => {
    expect(render("See https://example.com/a/b and packages/app/src/foo.ts at 0a1b2c3d4e5f6a7b.", "en")).toBe(
      "See a link and foo.ts at.",
    )
  })

  test("markdown is flattened", () => {
    expect(render("## **Done**: `bun test` passes", "en")).toBe("Done: bun test passes")
  })

  test("stack traces, JSON and diffs are replaced by the details phrase", () => {
    expect(render("  at Object.run (file.ts:10:3)", "en")).toBe(phrase("en", "details"))
    expect(render('{"key": "value", "n": 1}', "en")).toBe(phrase("en", "details"))
    expect(render("@@ -1,3 +1,4 @@", "en")).toBe(phrase("en", "details"))
  })

  test("phrases exist for every supported language", () => {
    for (const language of speechLanguages) {
      expect(phrase(language, "code")).toBe(PHRASES[language].code)
      expect(phrase(language, "list_rest", { count: 3 })).toContain("3")
    }
    expect(phrase("pt", "secret")).toBe(PHRASES.en.secret) // unknown language falls back to English
  })

  test("long numbers are kept", () => {
    expect(render("It costs 123456789012 euros.", "en")).toBe("It costs 123456789012 euros.")
  })

  test("redaction is idempotent (the pipeline can run twice safely)", () => {
    const once = redactSecrets("token=abcdefghijklmnop", "en")
    expect(redactSecrets(once, "en")).toBe(once)
  })

  test("renderSegment turns markers into localised phrases and prose into speakable text", () => {
    expect(renderSegment({ kind: "code", text: "", count: 0 }, "fr")).toBe(PHRASES.fr.code)
    expect(renderSegment({ kind: "table", text: "", count: 0 }, "fr")).toBe(PHRASES.fr.table)
    expect(renderSegment({ kind: "list_rest", text: "", count: 4 }, "fr")).toBe(
      PHRASES.fr.list_rest.replace("{count}", "4"),
    )
    expect(renderSegment({ kind: "prose", text: "## Bonjour **à tous**", count: 0 }, "fr")).toBe("Bonjour à tous")
    expect(renderSegment({ kind: "prose", text: '{"key": "value"}', count: 0 }, "fr")).toBe(PHRASES.fr.details)
  })
})
