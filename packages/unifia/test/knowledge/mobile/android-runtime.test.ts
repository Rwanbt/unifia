/* SPDX-License-Identifier: MIT */
import { describe, it, expect } from "bun:test"
import {
  PROBES,
  NO_DEVICE,
  runProbes,
  hasFailures,
} from "../../../src/knowledge/mobile/android-runtime.js"

describe("P10 Android runtime probe", () => {
  it("PROBES lists 10 canonical probes", () => {
    expect(PROBES).toHaveLength(10)
  })

  it("returns NOT_EXECUTED_EXTERNAL_BOUNDARY for every probe when no device", () => {
    const r = runProbes(NO_DEVICE)
    expect(r.every((p) => p.status === "NOT_EXECUTED_EXTERNAL_BOUNDARY")).toBe(true)
  })

  it("does not report failures when no device is attached", () => {
    const r = runProbes(NO_DEVICE)
    expect(hasFailures(r)).toBe(false)
  })

  it("returns PASS placeholders when a device is present", () => {
    const r = runProbes({
      hasDevice: true,
      hasInstalledApk: true,
      apkPath: "/tmp/app.apk",
      onDeviceVault: "/sdcard/Documents/UnifiaVault",
    })
    expect(r.every((p) => p.status === "PASS")).toBe(true)
  })
})
