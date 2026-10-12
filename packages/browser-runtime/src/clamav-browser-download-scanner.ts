/* SPDX-License-Identifier: MIT */
import { execFile } from "node:child_process"
import type { BrowserDownloadScanVerdict, BrowserDownloadScanner } from "./browser-download-store.ts"

const SCAN_TIMEOUT_MS = 120_000
const MAX_SCAN_TIME_MS = 90_000
const MAX_SCAN_OUTPUT_BYTES = 1024 * 1024
const CLAMAV_SCAN_ARGUMENTS = [
  "--quiet", "--infected", "--alert-exceeds-max=yes", "--alert-encrypted=yes", "--alert-broken=yes",
  "--max-filesize=50M", "--max-scansize=100M", `--max-scantime=${MAX_SCAN_TIME_MS}`,
]

export type ClamAvProcessResult = { exitCode: number; output: string }
export type ClamAvProcessRunner = (command: string, arguments_: readonly string[]) => Promise<ClamAvProcessResult>

/** Invokes a configured ClamAV executable without a shell and fails closed on scanner errors. */
export class ClamAvBrowserDownloadScanner implements BrowserDownloadScanner {
  readonly #command: string
  readonly #run: ClamAvProcessRunner

  constructor(command: string, run: ClamAvProcessRunner = runClamAv) {
    if (!command.trim()) throw new Error("ClamAV executable path is required")
    this.#command = command
    this.#run = run
  }

  async scan(path: string): Promise<BrowserDownloadScanVerdict> {
    try {
      const result = await this.#run(this.#command, [...CLAMAV_SCAN_ARGUMENTS, path])
      if (result.exitCode === 1 || /\bFOUND\b/.test(result.output)) return "malicious"
      return result.exitCode === 0 ? "clean" : "unavailable"
    } catch {
      return "unavailable"
    }
  }
}

function runClamAv(command: string, arguments_: readonly string[]): Promise<ClamAvProcessResult> {
  return new Promise((resolve, reject) => {
    execFile(command, [...arguments_], {
      encoding: "utf8",
      maxBuffer: MAX_SCAN_OUTPUT_BYTES,
      timeout: SCAN_TIMEOUT_MS,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      if (!error) return resolve({ exitCode: 0, output: `${stdout}\n${stderr}` })
      const exitCode = (error as NodeJS.ErrnoException & { code?: string | number }).code
      if (typeof exitCode === "number") return resolve({ exitCode, output: `${stdout}\n${stderr}` })
      reject(error)
    })
  })
}
