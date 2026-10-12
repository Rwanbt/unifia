/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { mobileStartupMode, prepareLocalRuntime } from "./startup"

describe("MobileStartup", () => {
  test("MobileStartup_Android_AlwaysPreparesLocal", () => {
    expect(mobileStartupMode("android")).toBe("extracting")
    expect(mobileStartupMode("ios")).toBe("remote-prompt")
  })

  for (const ready of [false, true]) {
    for (const extended_env of [false, true]) {
      test(`MobileStartup_RuntimeReady${ready}_ExtendedReady${extended_env}_PreparesMissingParts`, async () => {
        const calls: string[] = []
        await prepareLocalRuntime({
          check: async () => ({ ready, extended_env }),
          extract: async () => {
            calls.push("extract")
          },
          install: async () => {
            calls.push("install")
          },
          onInstall: () => {
            calls.push("progress")
          },
        })
        expect(calls).toEqual([...(!ready ? ["extract"] : []), ...(!extended_env ? ["progress", "install"] : [])])
      })
    }
  }

  test("MobileStartup_ExtractionFailure_DoesNotInstall", async () => {
    let installed = false
    await expect(
      prepareLocalRuntime({
        check: async () => ({ ready: false, extended_env: false }),
        extract: async () => {
          throw new Error("extraction failed")
        },
        install: async () => {
          installed = true
        },
        onInstall: () => {},
      }),
    ).rejects.toThrow("extraction failed")
    expect(installed).toBe(false)
  })

  test("MobileStartup_InstallationFailure_IsReported", async () => {
    await expect(
      prepareLocalRuntime({
        check: async () => ({ ready: true, extended_env: false }),
        extract: async () => {},
        install: async () => {
          throw new Error("tools unavailable")
        },
        onInstall: () => {},
      }),
    ).rejects.toThrow("tools unavailable")
  })
})
