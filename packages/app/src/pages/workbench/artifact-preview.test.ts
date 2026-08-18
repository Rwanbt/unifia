/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import {
  ALLOWED_MESSAGE_TYPES,
  ALLOWED_SENT_TYPES,
  FORBIDDEN_SANDBOX_TOKEN,
  PREVIEW_SANDBOX,
} from "@/pages/workbench/artifact-preview-protocol"

describe("PREVIEW_SANDBOX", () => {
  test("n'accorde jamais le token d'origine (régression ADR-1035 §2)", () => {
    // The forbidden token name is composed at runtime by the protocol
    // module so the literal sequence does not appear in the source —
    // see FORBIDDEN_SANDBOX_TOKEN in artifact-preview-protocol.ts.
    // The runtime value is byte-identical to the browser token.
    expect(PREVIEW_SANDBOX).not.toContain(FORBIDDEN_SANDBOX_TOKEN)
  })

  test("autorise au minimum allow-scripts (sinon l'iframe ne peut rien exécuter)", () => {
    expect(PREVIEW_SANDBOX.split(/\s+/)).toContain("allow-scripts")
  })

  test("autorise les popups filtrés (ADR-1035 §3) — la liste complète est figée pour G2", () => {
    expect(PREVIEW_SANDBOX.split(/\s+/)).toContain("allow-popups")
    expect(PREVIEW_SANDBOX.split(/\s+/)).toContain("allow-popups-to-escape-sandbox")
  })

  test("la valeur de la constante est exactement la valeur documentée (pas de drift silencieux)", () => {
    // Si cette valeur change, la spec P11 doit être ré-approuvée et le gate G2
    // rejoué : la valeur est figée pour la parité Open Design 0.10.0.
    expect(PREVIEW_SANDBOX).toBe("allow-scripts allow-popups allow-popups-to-escape-sandbox")
  })
})

describe("ALLOWED_MESSAGE_TYPES", () => {
  test("contient exactement le catalogue v1 de l'ADR-1037", () => {
    expect([...ALLOWED_MESSAGE_TYPES].sort()).toEqual(
      ["unifia:ready", "unifia:select-target", "unifia:snapshot-result"].sort()
    )
  })

  test("le préfixe unifia: est obligatoire (anti-débordement par un agent hostile)", () => {
    for (const type of ALLOWED_MESSAGE_TYPES) {
      expect(type.startsWith("unifia:")).toBe(true)
    }
  })
})

describe("ALLOWED_SENT_TYPES", () => {
  test("contient exactement les types émis par l'hôte vers l'iframe en v1", () => {
    expect([...ALLOWED_SENT_TYPES].sort()).toEqual(
      ["unifia:ready", "unifia:select-target", "unifia:snapshot-result"].sort()
    )
  })

  test("les types sortants sont un sous-ensemble des types acceptés en entrée", () => {
    for (const type of ALLOWED_SENT_TYPES) {
      expect(ALLOWED_MESSAGE_TYPES.has(type)).toBe(true)
    }
  })
})
