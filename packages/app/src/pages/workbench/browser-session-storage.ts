/* SPDX-License-Identifier: MIT */

export function browserSessionStorageKey(workspaceId: string, chatSessionId: string): string {
  return `unifia.browser.session.v1.${encodeURIComponent(workspaceId)}:${encodeURIComponent(chatSessionId)}`
}

export function legacyBrowserSessionStorageKey(workspaceId: string): string {
  return `unifia.browser.session.v1.${workspaceId}`
}
