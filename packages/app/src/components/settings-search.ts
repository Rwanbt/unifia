/* SPDX-License-Identifier: MIT */

// Accents and case are ignored so "memoire" finds "Mémoire".
export function normalizeSettingText(text: string) {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim()
}

export function matchesSettingQuery(text: string, query: string) {
  const needle = normalizeSettingText(query)
  if (!needle) return true
  return normalizeSettingText(text).includes(needle)
}

/** Hides the rows of the open settings page that do not match the query. */
export function filterSettingRows(page: ParentNode, query: string) {
  for (const row of page.querySelectorAll<HTMLElement>('[data-v110="setting-row"]')) {
    row.hidden = !matchesSettingQuery(row.textContent ?? "", query)
  }
}
