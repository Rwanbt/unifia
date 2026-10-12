/* SPDX-License-Identifier: MIT */

import { afterEach, describe, expect, test } from "bun:test"
import { ghostCopy, withModeMotion } from "./mode-motion"

describe("withModeMotion", () => {
  afterEach(() => {
    delete document.documentElement.dataset.uiAnimations
  })

  test("ModeMotion_AnimationsOff_RunsTheChangeWithoutGhosts", () => {
    document.documentElement.dataset.uiAnimations = "off"
    let changed = 0
    withModeMotion(() => changed++)
    expect(changed).toBe(1)
    expect(document.body.querySelector('[aria-hidden="true"][inert]')).toBeNull()
  })
})

describe("ghostCopy", () => {
  test("GhostCopy_SurfaceCard_DropsIdentityMarkersAndKeepsTheOriginal", () => {
    const card = document.createElement("section")
    card.id = "card"
    card.innerHTML = '<div data-workbench-surface="design" id="inner"><p data-v110="title">Design</p></div>'
    const copy = ghostCopy(card)
    expect(copy.querySelector("[data-workbench-surface]")).toBeNull()
    expect(copy.querySelector("[id]")).toBeNull()
    expect(copy.id).toBe("")
    expect(copy.querySelector('[data-v110="title"]')?.textContent).toBe("Design")
    expect(card.querySelector('[data-workbench-surface="design"]')).not.toBeNull()
  })
})
