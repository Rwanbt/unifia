/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { clearPreview, previewInComposer } from "./composer-preview"

function composer() {
  document.body.innerHTML = `<div data-component="prompt-input" contenteditable="true">déjà<br></div>`
  return document.querySelector<HTMLElement>("[data-component='prompt-input']")!
}

describe("composer preview", () => {
  test("successive partials update one preview in place, before the trailing break", () => {
    const editor = composer()
    previewInComposer(document, "bonjour")
    previewInComposer(document, "bonjour le monde")

    const previews = editor.querySelectorAll("[data-stt-preview]")
    expect(previews).toHaveLength(1)
    expect(previews[0]!.textContent).toBe("bonjour le monde")
    expect(editor.lastChild?.nodeName).toBe("BR")
  })

  test("clearing leaves the typed text untouched", () => {
    const editor = composer()
    previewInComposer(document, "bonjour")
    clearPreview(document)
    expect(editor.innerHTML).toBe("déjà<br>")
  })
})
