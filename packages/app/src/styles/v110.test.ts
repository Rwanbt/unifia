/* SPDX-License-Identifier: MIT */

import { afterEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const APP_ENTRY = resolve(import.meta.dir, "..", "..", "src", "index.css")
const V110_CSS = resolve(import.meta.dir, "..", "..", "src", "styles", "v110.css")
const V110_CHAT_CSS = resolve(import.meta.dir, "..", "..", "src", "styles", "v110-chat.css")
const PROMPT_INPUT = resolve(import.meta.dir, "..", "..", "src", "components", "prompt-input.tsx")

// A1 Wave 0 — v110.css contract. Follows the unifia-brand.test.ts pattern:
// string match for the cascade wiring plus a happy-dom smoke for :root.
describe("A1 — v110.css shell contract is wired into the app", () => {
  test("index.css imports v110.css once, after brand", () => {
    const css = readFileSync(APP_ENTRY, "utf8")
    const matches = css.match(/@import\s+["']@\/styles\/v110\.css["']/g) ?? []
    expect(matches.length).toBe(1)
    expect(css.indexOf("@/styles/v110.css")).toBeGreaterThan(css.indexOf("@/styles/unifia-brand.css"))
  })

  test("shell geometry matches the maquette tokens", () => {
    const css = readFileSync(V110_CSS, "utf8")
    for (const token of [
      "--v110-topbar: 48px",
      "--v110-rail: 62px",
      "--v110-rail-compact: 62px",
      "--v110-context: 248px",
      "--v110-inspector: 300px",
      "--v110-chat: 348px",
      "--v110-chat-min: 280px",
      "--v110-chat-max: 620px",
      "--v110-radius-sm: 10px",
      "--v110-radius-md: 12px",
      "--v110-radius-lg: 15px",
      "--v110-radius-xl: 18px",
      "--v110-target: 31px",
      "--v110-target-touch: 44px",
    ])
      expect(css).toContain(token)
  })

  test("narrow-desktop overrides, focus and motion contracts are present", () => {
    const css = readFileSync(V110_CSS, "utf8")
    expect(css).toContain("@media (max-width: 1360px)")
    expect(css).toContain("--v110-context: 220px")
    expect(css).toContain("--v110-chat: 330px")
    expect(css).toContain("--v110-inspector: 280px")
    expect(css).toContain("--v110-focus:")
    expect(css).toContain(":where(button, input, textarea, select, [tabindex]):focus-visible")
    expect(css).toContain("--v110-ease: cubic-bezier(0.16, 0.84, 0.2, 1)")
    expect(css).toContain("prefers-reduced-motion")
    expect(css).toContain('html[data-ui-animations="off"]')
  })

  test("the sheet never masks architecture with important", () => {
    const css = readFileSync(V110_CSS, "utf8")
    // The `.mobile-side-panel` selector is the one allowed exception:
    // it must beat Tailwind's mobile-only utilities (`.absolute.inset-0`,
    // `z-30`, `!hidden`) that ship alongside the host component. See
    // commit `3b794c09ff fix(shell): align inspector overlays with
    // v110 viewport contract` for the original rationale.
    const lines = css.split("\n")
    const violations: string[] = []
    let insideMobileSidePanel = false
    for (const line of lines) {
      if (line.match(/\.mobile-side-panel/)) insideMobileSidePanel = true
      else if (line.trim().endsWith("}")) insideMobileSidePanel = false
      if (line.includes("!important") && !insideMobileSidePanel) {
        violations.push(line.trim())
      }
    }
    expect(violations).toEqual([])
  })

  test("loading the sheet exposes --v110-topbar on :root", () => {
    const css = readFileSync(V110_CSS, "utf8")
    const style = document.createElement("style")
    style.setAttribute("data-v110-smoke", "true")
    style.textContent = css
    document.head.appendChild(style)
    try {
      const value = getComputedStyle(document.documentElement).getPropertyValue("--v110-topbar").trim()
      expect(value).toBe("48px")
    } finally {
      style.remove()
    }
  })

  test("chat composer targets the real prompt anchors", () => {
    const css = readFileSync(V110_CHAT_CSS, "utf8")
    expect(css).toContain('[data-dock-surface="shell"]')
    expect(css).toContain('[data-component="prompt-input"]')
    expect(css).toContain('[data-dock-surface="tray"]')
    expect(css).toContain('[data-action^="prompt-"]')
    expect(css).not.toContain('[data-v110="composer-dock"] textarea')
  })

  // The todo, revert and follow-up docks are DockTrays too, siblings of the
  // prompt composer inside composer-dock. The rules that pin the prompt's own
  // control tray must not reach them: a todo list pinned at left:8px bottom:14px
  // of the chat surface landed on top of the composer.
  test("prompt tray rules only reach the prompt's own tray, not the session docks", () => {
    const style = document.createElement("style")
    style.textContent = readFileSync(V110_CHAT_CSS, "utf8")
    document.head.appendChild(style)
    const dock = document.createElement("div")
    dock.innerHTML = `
      <div data-v110="composer-dock">
        <div><div data-dock-surface="tray" data-component="session-todo-dock"></div></div>
        <div data-v110="prompt-composer">
          <div data-dock-surface="shell"></div>
          <div data-dock-surface="tray" data-probe="prompt-tray"></div>
        </div>
      </div>`
    document.body.appendChild(dock)
    try {
      const todo = dock.querySelector('[data-component="session-todo-dock"]')!
      const promptTray = dock.querySelector('[data-probe="prompt-tray"]')!
      expect(getComputedStyle(promptTray).position).toBe("absolute")
      expect(getComputedStyle(todo).position).not.toBe("absolute")
    } finally {
      dock.remove()
      style.remove()
    }
  })

  test("prompt controls stay left-anchored and compact controls remain actionable", () => {
    const css = readFileSync(V110_CHAT_CSS, "utf8")
    const prompt = readFileSync(PROMPT_INPUT, "utf8")
    expect(css).toContain("@container (max-width: 620px)")
    expect(css).toContain('[data-slot="select-select-trigger-value"]')
    expect(css).toContain('[data-v110="prompt-control"] [data-slot="select-select-trigger-icon"]')
    expect(css).toContain("left: 8px")
    expect(css).toContain("bottom: calc(100% + 14px)")
    expect(css).toContain("bottom: calc(100% + 18px)")
    expect(css).not.toContain("justify-content: flex-end")
    expect(prompt).not.toContain('Icon name="chevron-down"')
    expect(prompt).toContain('data-v110": "prompt-control"')
  })
})

afterEach(() => {
  for (const node of Array.from(document.head.querySelectorAll("style[data-v110-smoke]"))) node.remove()
})
