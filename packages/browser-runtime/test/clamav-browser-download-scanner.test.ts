/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { ClamAvBrowserDownloadScanner } from "../src/clamav-browser-download-scanner.ts"

describe("ClamAvBrowserDownloadScanner", () => {
  test("runs the configured scanner with the file as a separate argument", async () => {
    const calls: unknown[][] = []
    const scanner = new ClamAvBrowserDownloadScanner("C:\\Program Files\\ClamAV\\clamscan.exe", async (...args) => {
      calls.push(args)
      return { exitCode: 0, output: "" }
    })

    expect(await scanner.scan("D:\\Browser Quarantine\\report.pdf")).toBe("clean")
    expect(calls).toEqual([[
      "C:\\Program Files\\ClamAV\\clamscan.exe",
      ["--quiet", "--infected", "--alert-exceeds-max=yes", "--alert-encrypted=yes", "--alert-broken=yes", "--max-filesize=50M", "--max-scansize=100M", "--max-scantime=90000", "D:\\Browser Quarantine\\report.pdf"],
    ]])
  })

  test("distinguishes detected malware from scanner failure", async () => {
    const malicious = new ClamAvBrowserDownloadScanner("clamscan", async () => ({ exitCode: 1, output: "" }))
    const unavailable = new ClamAvBrowserDownloadScanner("clamscan", async () => ({ exitCode: 2, output: "database unavailable" }))
    const spawnFailure = new ClamAvBrowserDownloadScanner("missing-clamscan", async () => { throw new Error("ENOENT") })

    expect(await malicious.scan("sample.exe")).toBe("malicious")
    expect(await unavailable.scan("sample.exe")).toBe("unavailable")
    expect(await spawnFailure.scan("sample.exe")).toBe("unavailable")
  })
})
