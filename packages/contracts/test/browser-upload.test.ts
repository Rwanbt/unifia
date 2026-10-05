/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { BrowserUploadInputSchema, MAX_BROWSER_UPLOAD_BYTES } from "../src/browser.ts"

describe("Browser upload input", () => {
  test("accepts a bounded single-file payload", () => {
    expect(BrowserUploadInputSchema.parse({ name: "report.pdf", mediaType: "application/pdf", base64: "c2FmZQ==" })).toEqual({
      name: "report.pdf",
      mediaType: "application/pdf",
      base64: "c2FmZQ==",
    })
    expect(MAX_BROWSER_UPLOAD_BYTES).toBe(4 * 1024 * 1024)
  })

  test.each([
    { name: "../secret.txt", mediaType: "text/plain", base64: "c2FmZQ==" },
    { name: "safe.txt", mediaType: "text/plain; charset=utf-8", base64: "c2FmZQ==" },
    { name: "safe.txt", mediaType: "text/plain", base64: "not base64!" },
  ])("rejects unsafe upload metadata or encoding", (payload) => {
    expect(() => BrowserUploadInputSchema.parse(payload)).toThrow()
  })
})
