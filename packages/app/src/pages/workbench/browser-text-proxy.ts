/* SPDX-License-Identifier: MIT */
/**
 * The remote page is a screenshot, so nothing in it can own the focus that
 * makes a phone open its keyboard. A hidden textarea takes that focus instead,
 * and what is typed into it is replayed on the page as Browser input.
 *
 * Android keyboards do not report text through keydown (the key is
 * "Unidentified"); it arrives as the textarea's value. The textarea always
 * holds one sentinel character so that Backspace still has something to
 * delete, and an input event on an otherwise empty field still fires.
 */
export const TEXT_PROXY_SENTINEL = " "

export type BrowserTextCommand = { kind: "text"; text: string } | { kind: "key"; key: string }

/** Commands for the textarea's value after an edit; the caller then resets it to the sentinel. */
export function textProxyCommands(value: string): BrowserTextCommand[] {
  if (!value.startsWith(TEXT_PROXY_SENTINEL)) return [{ kind: "key", key: "Backspace" }]
  const typed = value.slice(TEXT_PROXY_SENTINEL.length)
  const commands: BrowserTextCommand[] = []
  typed.split("\n").forEach((line, index) => {
    if (index > 0) commands.push({ kind: "key", key: "Enter" })
    if (line) commands.push({ kind: "text", text: line })
  })
  return commands
}

/**
 * Whether keydown should send this key itself. Printable characters and the
 * keyboard's "Unidentified" are left to the input event, which carries the text.
 */
export function isForwardedKey(key: string): boolean {
  return key.length > 1 && key !== "Unidentified" && key !== "Process"
}
