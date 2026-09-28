/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { closeTab, openTab } from "@/pages/workbench/design-tabs"
import { seedDesignTabState } from "@/pages/workbench/design-workspace"

describe("seedDesignTabState (Phase 3)", () => {
  // ADR-085: Design opens on the canvas studio, like the reference.
  test("sème trois onglets non fermables: 'canvas', 'spec' puis 'files'", () => {
    const state = seedDesignTabState()
    expect(state.tabs.map((t) => t.id)).toEqual(["canvas", "spec", "files"])
    expect(state.tabs.map((t) => t.kind)).toEqual(["canvas", "spec", "file"])
    expect(state.tabs.every((t) => !t.closable)).toBe(true)
  })

  test("l'onglet actif après le seed est le canvas", () => {
    const state = seedDesignTabState()
    expect(state.activeId).toBe("canvas")
  })

  test("les onglets semés refusent d'être fermés (le réducteur renvoie l'état inchangé)", () => {
    const state = seedDesignTabState()
    for (const id of ["canvas", "spec", "files"]) expect(closeTab(state, id)).toBe(state)
  })

  test("un onglet d'artefact ouvert après le seed coexiste avec les onglets semés", () => {
    const state = seedDesignTabState()
    const withArtifact = openTab(state, {
      id: "artifact-1",
      kind: "artifact",
      title: "artifact-1.html",
      closable: true,
    })
    expect(withArtifact.tabs.map((t) => t.id)).toEqual(["canvas", "spec", "files", "artifact-1"])
    expect(withArtifact.activeId).toBe("artifact-1")
  })

  test("fermer l'onglet artefact ne touche pas les onglets non-fermables", () => {
    const seeded = seedDesignTabState()
    const withArtifact = openTab(seeded, {
      id: "artifact-1",
      kind: "artifact",
      title: "artifact-1.html",
      closable: true,
    })
    const afterClose = closeTab(withArtifact, "artifact-1")
    expect(afterClose.tabs.map((t) => t.id)).toEqual(["canvas", "spec", "files"])
    // Règle du réducteur : fermer l'onglet actif active son voisin de gauche.
    expect(afterClose.activeId).toBe("files")
  })

  test("réutiliser seedDesignTabState ne mute pas l'état précédent (état frais)", () => {
    const first = seedDesignTabState()
    const second = seedDesignTabState()
    expect(first).not.toBe(second)
    expect(first.tabs).toEqual(second.tabs)
    // Les tableaux internes sont aussi frais — muter l'un n'affecte pas l'autre.
    expect(first.tabs).not.toBe(second.tabs)
  })
})
