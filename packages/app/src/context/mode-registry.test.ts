/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createModeRegistry } from "./mode-registry"

describe("mode registry", () => {
  test("Publish_ThenRead_ReturnsThePublishedItemsOfThatModeOnly", () => {
    createRoot((dispose) => {
      const registry = createModeRegistry<string>()
      registry.publish("design", () => ["a"])
      registry.publish("work", () => ["b"])
      expect(registry.read("design")).toEqual(["a"])
      expect(registry.read("automate")).toEqual([])
      dispose()
    })
  })

  test("PublishedAccessor_IsReactive", () => {
    createRoot((dispose) => {
      const registry = createModeRegistry<string>()
      const [value, setValue] = createSignal("one")
      registry.publish("memory", () => [value()])
      expect(registry.read("memory")).toEqual(["one"])
      setValue("two")
      expect(registry.read("memory")).toEqual(["two"])
      dispose()
    })
  })

  test("Dispose_RemovesThePublisher", () => {
    const registry = createModeRegistry<string>()
    createRoot((dispose) => {
      registry.publish("design", () => ["a"])
      dispose()
    })
    expect(registry.read("design")).toEqual([])
  })

  test("TwoPublishersOfOneMode_AreConcatenatedInOrder", () => {
    createRoot((dispose) => {
      const registry = createModeRegistry<string>()
      registry.publish("browser", () => ["a"])
      registry.publish("browser", () => ["b"])
      expect(registry.read("browser")).toEqual(["a", "b"])
      dispose()
    })
  })
})
