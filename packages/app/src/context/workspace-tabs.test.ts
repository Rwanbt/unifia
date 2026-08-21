/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import {
  ENTRY_TAB_ID,
  activateWorkspaceTab,
  closeWorkspaceTab,
  deserializeWorkspaceTabState,
  emptyWorkspaceTabState,
  openWorkspaceTab,
  reorderWorkspaceTab,
  serializeWorkspaceTabState,
  touchWorkspaceTab,
  type WorkspaceTab,
  type WorkspaceTabState,
} from "@/context/workspace-tabs"

function projectTab(id: string, opts: Partial<Omit<WorkspaceTab, "id">> = {}): WorkspaceTab {
  return {
    id,
    kind: "project",
    title: id,
    href: `/${id}/session/ses-1`,
    closable: true,
    createdAt: 1_700_000_000,
    lastActiveAt: 1_700_000_000,
    ...opts,
  }
}

describe("emptyWorkspaceTabState", () => {
  test("sème l'onglet entry, qui est l'actif initial et non fermable", () => {
    const state = emptyWorkspaceTabState()
    expect(state.tabs).toHaveLength(1)
    expect(state.tabs[0]?.id).toBe(ENTRY_TAB_ID)
    expect(state.tabs[0]?.kind).toBe("entry")
    expect(state.tabs[0]?.closable).toBe(false)
    expect(state.activeId).toBe(ENTRY_TAB_ID)
  })

  test("deux appels renvoient des états frais (pas de partage de référence)", () => {
    const first = emptyWorkspaceTabState()
    const second = emptyWorkspaceTabState()
    expect(first).not.toBe(second)
    expect(first.tabs).not.toBe(second.tabs)
    expect(first.tabs[0]).not.toBe(second.tabs[0])
  })
})

describe("openWorkspaceTab", () => {
  test("ajoute un onglet project après l'entry et l'active", () => {
    const start = emptyWorkspaceTabState()
    const next = openWorkspaceTab(start, projectTab("p-1"), 1)
    expect(next.tabs).toHaveLength(2)
    expect(next.tabs[0]?.id).toBe(ENTRY_TAB_ID)
    expect(next.tabs[1]?.id).toBe("p-1")
    expect(next.activeId).toBe("p-1")
  })

  test("un onglet déjà ouvert est activé au lieu d'être dupliqué, et son lastActiveAt est mis à jour", () => {
    const start = openWorkspaceTab(emptyWorkspaceTabState(), projectTab("p-1", { lastActiveAt: 100 }), 100)
    const reopened = openWorkspaceTab(start, projectTab("p-1", { lastActiveAt: 200 }), 200)
    expect(reopened.tabs).toHaveLength(2)
    expect(reopened.tabs.find((t) => t.id === "p-1")?.lastActiveAt).toBe(200)
    expect(reopened.activeId).toBe("p-1")
  })

  test("l'ordre d'insertion respecte la règle entry-premier : un deuxième project va après le premier", () => {
    const start = openWorkspaceTab(emptyWorkspaceTabState(), projectTab("p-1"), 1)
    const next = openWorkspaceTab(start, projectTab("p-2"), 2)
    expect(next.tabs.map((t) => t.id)).toEqual([ENTRY_TAB_ID, "p-1", "p-2"])
  })
})

describe("closeWorkspaceTab", () => {
  test("refuse de fermer l'entry (closable: false) — renvoie l'état inchangé", () => {
    const start = emptyWorkspaceTabState()
    const next = closeWorkspaceTab(start, ENTRY_TAB_ID, 1)
    expect(next).toBe(start)
    expect(next.tabs).toHaveLength(1)
  })

  test("ferme un onglet project et l'active reste sur entry", () => {
    const start = openWorkspaceTab(emptyWorkspaceTabState(), projectTab("p-1"), 1)
    const next = closeWorkspaceTab(start, "p-1", 2)
    expect(next.tabs).toHaveLength(1)
    expect(next.tabs[0]?.id).toBe(ENTRY_TAB_ID)
    expect(next.activeId).toBe(ENTRY_TAB_ID)
  })

  test("fermer l'onglet actif active le suivant à droite (pas l'entry)", () => {
    const start = openWorkspaceTab(emptyWorkspaceTabState(), projectTab("p-1"), 1)
    const with2 = openWorkspaceTab(start, projectTab("p-2", { lastActiveAt: 1 }), 1)
    // L'onglet actif est p-2 (le dernier ouvert). Fermer p-2 active p-1.
    expect(with2.activeId).toBe("p-2")
    const after = closeWorkspaceTab(with2, "p-2", 2)
    expect(after.tabs.map((t) => t.id)).toEqual([ENTRY_TAB_ID, "p-1"])
    expect(after.activeId).toBe("p-1")
    // lastActiveAt du nouveau actif est bumpé.
    expect(after.tabs.find((t) => t.id === "p-1")?.lastActiveAt).toBe(2)
  })

  test("fermer un onglet inactif conserve activeId", () => {
    const start = openWorkspaceTab(emptyWorkspaceTabState(), projectTab("p-1"), 1)
    const with2 = openWorkspaceTab(start, projectTab("p-2"), 2)
    // Active = p-2. Fermer p-1 (inactif) ne change pas activeId.
    const after = closeWorkspaceTab(with2, "p-1", 3)
    expect(after.activeId).toBe("p-2")
    expect(after.tabs.map((t) => t.id)).toEqual([ENTRY_TAB_ID, "p-2"])
  })

  test("un id inexistant renvoie l'état inchangé", () => {
    const start = emptyWorkspaceTabState()
    const next = closeWorkspaceTab(start, "missing", 1)
    expect(next).toBe(start)
  })
})

describe("activateWorkspaceTab", () => {
  test("active un onglet existant et met à jour lastActiveAt", () => {
    const start = openWorkspaceTab(emptyWorkspaceTabState(), projectTab("p-1", { lastActiveAt: 100 }), 100)
    const next = activateWorkspaceTab(start, "p-1", 200)
    expect(next.activeId).toBe("p-1")
    expect(next.tabs.find((t) => t.id === "p-1")?.lastActiveAt).toBe(200)
  })

  test("active l'entry (qui est un onglet comme un autre)", () => {
    const start = openWorkspaceTab(emptyWorkspaceTabState(), projectTab("p-1"), 1)
    const next = activateWorkspaceTab(start, ENTRY_TAB_ID, 2)
    expect(next.activeId).toBe(ENTRY_TAB_ID)
  })

  test("un id inexistant renvoie l'état inchangé", () => {
    const start = emptyWorkspaceTabState()
    const next = activateWorkspaceTab(start, "missing", 1)
    expect(next).toBe(start)
  })
})

describe("touchWorkspaceTab", () => {
  test("met à jour lastActiveAt sans changer activeId", () => {
    const start = openWorkspaceTab(emptyWorkspaceTabState(), projectTab("p-1", { lastActiveAt: 100 }), 100)
    const active = openWorkspaceTab(start, projectTab("p-2"), 200)
    // Active = p-2. Touch p-1 ne change pas activeId.
    const next = touchWorkspaceTab(active, "p-1", 300)
    expect(next.activeId).toBe("p-2")
    expect(next.tabs.find((t) => t.id === "p-1")?.lastActiveAt).toBe(300)
  })
})

describe("reorderWorkspaceTab", () => {
  function threeProjects(): WorkspaceTabState {
    const s1 = openWorkspaceTab(emptyWorkspaceTabState(), projectTab("p-1"), 1)
    const s2 = openWorkspaceTab(s1, projectTab("p-2"), 2)
    return openWorkspaceTab(s2, projectTab("p-3"), 3)
  }

  test("déplace un onglet vers une position ultérieure", () => {
    const start = threeProjects() // [entry, p-1, p-2, p-3]
    const next = reorderWorkspaceTab(start, "p-1", 3)
    expect(next.tabs.map((t) => t.id)).toEqual([ENTRY_TAB_ID, "p-2", "p-3", "p-1"])
  })

  test("déplace un onglet vers une position antérieure", () => {
    const start = threeProjects()
    const next = reorderWorkspaceTab(start, "p-3", 1)
    expect(next.tabs.map((t) => t.id)).toEqual([ENTRY_TAB_ID, "p-3", "p-1", "p-2"])
  })

  test("ne change pas activeId", () => {
    const start = threeProjects() // actif = p-3 (dernier ouvert)
    const next = reorderWorkspaceTab(start, "p-1", 3)
    expect(next.activeId).toBe(start.activeId)
  })

  test("refuse de déplacer l'entry", () => {
    const start = threeProjects()
    const next = reorderWorkspaceTab(start, ENTRY_TAB_ID, 2)
    expect(next).toBe(start)
  })

  test("un id inexistant renvoie l'état inchangé", () => {
    const start = threeProjects()
    const next = reorderWorkspaceTab(start, "missing", 1)
    expect(next).toBe(start)
  })

  test("un toIndex identique au point de départ renvoie l'état inchangé", () => {
    const start = threeProjects()
    const next = reorderWorkspaceTab(start, "p-2", 2)
    expect(next).toBe(start)
  })

  test("un toIndex hors bornes renvoie l'état inchangé", () => {
    const start = threeProjects()
    expect(reorderWorkspaceTab(start, "p-1", -1)).toBe(start)
    expect(reorderWorkspaceTab(start, "p-1", 99)).toBe(start)
  })

  test("l'entry reste première même si toIndex viserait la position 0", () => {
    const start = threeProjects()
    const next = reorderWorkspaceTab(start, "p-2", 0)
    expect(next.tabs[0]?.id).toBe(ENTRY_TAB_ID)
    expect(next.tabs.map((t) => t.id)).toEqual([ENTRY_TAB_ID, "p-2", "p-1", "p-3"])
  })
})

describe("persistance (sérialisation/désérialisation)", () => {
  test("sérialiser puis désérialiser restitue un état équivalent", () => {
    const start = openWorkspaceTab(emptyWorkspaceTabState(), projectTab("p-1"), 100)
    const raw = serializeWorkspaceTabState(start)
    const restored = deserializeWorkspaceTabState(raw)
    expect(restored).toEqual(start)
  })

  test("désérialiser un JSON invalide renvoie null (pas d'exception)", () => {
    expect(deserializeWorkspaceTabState("not json")).toBeNull()
    expect(deserializeWorkspaceTabState("{}")).toBeNull()
    expect(deserializeWorkspaceTabState('{"tabs":"oops","activeId":1}')).toBeNull()
  })

  test("désérialiser sans entry restaure un état frais (refus)", () => {
    const orphan: WorkspaceTabState = { tabs: [projectTab("p-1")], activeId: "p-1" }
    const raw = serializeWorkspaceTabState(orphan)
    expect(deserializeWorkspaceTabState(raw)).toBeNull()
  })

  test("désérialiser avec un onglet malformé l'ignore (pas tout l'état)", () => {
    const raw = JSON.stringify({
      tabs: [
        { id: "entry", kind: "entry", title: "Accueil", href: "/", closable: false, createdAt: 0, lastActiveAt: 0 },
        { id: "broken", kind: "project" /* manque title, href, etc. */ },
        { id: "p-1", kind: "project", title: "p-1", href: "/p-1", closable: true, createdAt: 1, lastActiveAt: 1 },
      ],
      activeId: "p-1",
    })
    const restored = deserializeWorkspaceTabState(raw)
    expect(restored).not.toBeNull()
    expect(restored?.tabs.map((t) => t.id)).toEqual(["entry", "p-1"])
  })
})
