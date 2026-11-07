/* SPDX-License-Identifier: MIT */

// Provisional dictation transcript shown in the prompt composer, shared by the
// web/mobile shells and the desktop shell. The preview is a non-editable span
// that the final insertion removes, so it never becomes prompt text.

/**
 * Inserts before the trailing `<br>` the composer keeps at the end of its
 * content. Appending after that break yields an empty line above the text.
 */
export function append(editor: HTMLElement, node: Node) {
  let last = editor.lastChild
  if (last?.nodeType === Node.TEXT_NODE && (last.textContent ?? "") === "\u200B") last = last.previousSibling
  if (last?.nodeType === Node.ELEMENT_NODE && (last as HTMLElement).tagName === "BR") editor.insertBefore(node, last)
  else editor.append(node)
}

export function editorOf(doc: Document) {
  return doc.querySelector<HTMLElement>("[data-component='prompt-input'][contenteditable='true']")
}

/** Removes the provisional transcript, if one is shown. */
export function clearPreview(doc: Document) {
  editorOf(doc)?.querySelectorAll("[data-stt-preview]").forEach((node) => node.remove())
}

// Same rule as the final insertion: never focus the composer, or Android opens
// the soft keyboard and its cloud-backed dictation.
export function previewInComposer(doc: Document, text: string) {
  const editor = editorOf(doc)
  if (!editor) return
  const existing = editor.querySelector<HTMLElement>("[data-stt-preview]")
  if (existing) {
    existing.textContent = text
    return
  }
  const span = doc.createElement("span")
  span.dataset.sttPreview = "true"
  span.setAttribute("contenteditable", "false")
  span.style.opacity = "0.55"
  // A margin instead of a text node: the preview leaves nothing behind when removed.
  if ((editor.textContent ?? "").replaceAll("\u200B", "").trim()) span.style.marginLeft = "0.25em"
  append(editor, span)
  span.textContent = text
}
