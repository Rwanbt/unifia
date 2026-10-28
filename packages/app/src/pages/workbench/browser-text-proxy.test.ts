/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { TEXT_PROXY_SENTINEL, isForwardedKey, textProxyCommands } from "./browser-text-proxy"

describe("textProxyCommands", () => {
  test("textProxyCommands_TypedWord_SendsText", () => {
    expect(textProxyCommands(`${TEXT_PROXY_SENTINEL}hello`)).toEqual([{ kind: "text", text: "hello" }])
  })

  test("textProxyCommands_SentinelDeleted_SendsBackspace", () => {
    expect(textProxyCommands("")).toEqual([{ kind: "key", key: "Backspace" }])
  })

  test("textProxyCommands_NewLine_SendsEnterBetweenLines", () => {
    expect(textProxyCommands(`${TEXT_PROXY_SENTINEL}a\nb`)).toEqual([
      { kind: "text", text: "a" },
      { kind: "key", key: "Enter" },
      { kind: "text", text: "b" },
    ])
  })

  test("textProxyCommands_Unchanged_SendsNothing", () => {
    expect(textProxyCommands(TEXT_PROXY_SENTINEL)).toEqual([])
  })
})

describe("isForwardedKey", () => {
  test("isForwardedKey_NamedKeys_AreForwarded", () => {
    for (const key of ["Enter", "Backspace", "ArrowLeft", "Tab", "Escape"]) expect(isForwardedKey(key)).toBe(true)
  })

  test("isForwardedKey_TextAndImeKeys_AreLeftToInput", () => {
    for (const key of ["a", "é", " ", "Unidentified", "Process"]) expect(isForwardedKey(key)).toBe(false)
  })
})
