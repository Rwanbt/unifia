/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { takeWebLaunchToken, WEB_LAUNCH_TOKEN_KEY } from "./web-launch-token"

const memory = () => {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value), values }
}

describe("takeWebLaunchToken", () => {
  test("Fragment_TokenIsTakenStoredAndStrippedFromTheAddress", () => {
    const storage = memory()
    const replaced: string[] = []
    const token = takeWebLaunchToken({ hash: "#token=abc-123", pathname: "/L3JlcG8/browser", search: "?session=s" }, { replaceState: (_d, _u, url) => void replaced.push(url) }, storage)
    expect(token).toBe("abc-123")
    expect(storage.values.get(WEB_LAUNCH_TOKEN_KEY)).toBe("abc-123")
    expect(replaced).toEqual(["/L3JlcG8/browser?session=s"])
  })

  test("Reload_WithoutFragment_ReusesTheStoredToken", () => {
    const storage = memory()
    storage.setItem(WEB_LAUNCH_TOKEN_KEY, "kept")
    const replaced: string[] = []
    expect(takeWebLaunchToken({ hash: "", pathname: "/", search: "" }, { replaceState: (_d, _u, url) => void replaced.push(url) }, storage)).toBe("kept")
    expect(replaced).toEqual([])
  })

  test("OtherFragmentParameters_AreKept", () => {
    const replaced: string[] = []
    takeWebLaunchToken({ hash: "#token=t&tab=2", pathname: "/", search: "" }, { replaceState: (_d, _u, url) => void replaced.push(url) }, memory())
    expect(replaced).toEqual(["/#tab=2"])
  })

  test("NoTokenAnywhere_ReturnsUndefined", () => {
    expect(takeWebLaunchToken({ hash: "#other", pathname: "/", search: "" }, { replaceState: () => {} }, memory())).toBeUndefined()
  })
})
