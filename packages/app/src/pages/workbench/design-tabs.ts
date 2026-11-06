/* SPDX-License-Identifier: MIT */

export type DesignTabKind = "artifact" | "file" | "spec" | "terminal" | "browser" | "canvas" | "empty"

export type DesignTab = {
  id: string
  kind: DesignTabKind
  title: string
  closable: boolean
}

export type DesignTabState = {
  tabs: readonly DesignTab[]
  activeId: string | undefined
}

const EMPTY_STATE: DesignTabState = { tabs: [], activeId: undefined }

export function openTab(state: DesignTabState, tab: DesignTab): DesignTabState {
  // Règle : ouvrir un onglet déjà présent l'active au lieu de le dupliquer.
  if (state.tabs.some((existing) => existing.id === tab.id)) {
    return { tabs: state.tabs, activeId: tab.id }
  }
  return { tabs: [...state.tabs, tab], activeId: tab.id }
}

export function closeTab(state: DesignTabState, id: string): DesignTabState {
  const index = state.tabs.findIndex((tab) => tab.id === id)
  if (index === -1) return state
  const target = state.tabs[index]
  if (!target) return state
  // Règle : un onglet `closable: false` ne peut pas être fermé — renvoie l'état inchangé.
  if (!target.closable) return state
  const remaining = state.tabs.filter((_, i) => i !== index)
  if (state.activeId !== id) {
    return { tabs: remaining, activeId: state.activeId }
  }
  // Règle : fermer le dernier onglet laisse `activeId` à `undefined` et la liste vide.
  if (remaining.length === 0) {
    return EMPTY_STATE
  }
  // Règle : fermer l'onglet actif active son voisin de gauche, ou de droite s'il était le premier.
  const newActiveIndex = index > 0 ? index - 1 : 0
  const newActive = remaining[newActiveIndex]
  return {
    tabs: remaining,
    activeId: newActive ? newActive.id : undefined,
  }
}

export function activateTab(state: DesignTabState, id: string): DesignTabState {
  if (!state.tabs.some((tab) => tab.id === id)) return state
  return { tabs: state.tabs, activeId: id }
}

export function emptyDesignTabState(): DesignTabState {
  return EMPTY_STATE
}

/**
 * Built-in tabs carry a fixed id; their stored title is a fallback written at
 * creation (and possibly persisted in another language), so the label shown
 * is resolved from the current locale instead. Artifact tabs keep their title.
 */
const BUILTIN_TAB_LABEL_KEYS: Record<string, string> = {
  canvas: "design.workspace.openCanvas",
  files: "design.workspace.tab.files",
  terminal: "design.studio.workshop.terminal",
  browser: "design.studio.workshop.browser",
}

export function designTabLabel(tab: Pick<DesignTab, "id" | "title">, t: (key: string) => string): string {
  const key = BUILTIN_TAB_LABEL_KEYS[tab.id]
  return key ? t(key) : tab.title
}
