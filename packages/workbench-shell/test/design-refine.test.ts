/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import {
  buildRefinePrompt,
  buildRefineBatchPrompt,
  canSend,
  type RefineRequest,
} from "../src/design-refine"
import { addComment, EMPTY_COMMENT_STATE, type DesignComment } from "../src/design-comments"

function request(overrides: Partial<RefineRequest> = {}): RefineRequest {
  return {
    artifactId: "a-1",
    elementId: "path-0-2-1",
    note: "make this less prominent",
    entryFile: "design/index.html",
    ...overrides,
  }
}

function comment(overrides: Partial<DesignComment> = {}): DesignComment {
  return {
    id: "c-1",
    artifactId: "a-1",
    elementId: "path-0-2-1",
    note: "make this less prominent",
    status: "open",
    createdAt: "2026-08-18T10:00:00.000Z",
    ...overrides,
  }
}

describe("buildRefinePrompt — invariants du contenu", () => {
  test("contient le nom de fichier exact", () => {
    const prompt = buildRefinePrompt(request({ entryFile: "src/index.html" }))
    expect(prompt).toContain("src/index.html")
  })

  test("contient l'elementId dans data-unifia-id", () => {
    const prompt = buildRefinePrompt(request({ elementId: "path-3-7-2" }))
    expect(prompt).toContain('data-unifia-id="path-3-7-2"')
  })

  test("contient la note de l'utilisateur", () => {
    const prompt = buildRefinePrompt(request({ note: "change color to red" }))
    expect(prompt).toContain("change color to red")
  })

  test("contient une contrainte de non-régression explicite", () => {
    const prompt = buildRefinePrompt(request())
    expect(prompt).toMatch(/ONLY/i)
    expect(prompt).toMatch(/do NOT reformat/i)
  })

  test("demande une réponse sous forme d'artefact complet (markers <artifact>)", () => {
    const prompt = buildRefinePrompt(request())
    expect(prompt).toContain("<artifact>")
    expect(prompt).toContain("</artifact>")
  })
})

describe("buildRefinePrompt — robustesse aux notes piégeuses", () => {
  test("une note contenant des backticks ne casse pas les délimiteurs", () => {
    const prompt = buildRefinePrompt(request({ note: "use ```code``` here" }))
    // La note est entre délimiteurs ; les backticks à l'intérieur ne
    // peuvent pas fermer prématurément la fence (on n'utilise pas
    // de triple-backtick fence pour la note).
    expect(prompt).toContain("use ```code``` here")
    // Le délimiteur de fermeture doit suivre la note (pas un triple backtick)
    expect(prompt).toMatch(/<<<END-NOTE-.*?>>>[\s\S]*?Constraints:/)
  })

  test("une note contenant des chevrons ne casse pas la structure", () => {
    const prompt = buildRefinePrompt(request({ note: "if (x < 10 && y > 5) { return <a> }" }))
    expect(prompt).toContain("if (x < 10 && y > 5) { return <a> }")
  })

  test("une note vide reste valide (délimiteurs présents)", () => {
    const prompt = buildRefinePrompt(request({ note: "" }))
    expect(prompt).toContain("<<<NOTE-")
    expect(prompt).toContain(">>>")
    expect(prompt).toContain("<<<END-NOTE-")
  })
})

describe("buildRefinePrompt — déterminisme", () => {
  test("deux appels identiques produisent la même chaîne", () => {
    const r = request()
    const a = buildRefinePrompt(r)
    const b = buildRefinePrompt(r)
    expect(a).toBe(b)
  })

  test("l'entrée ne mute pas", () => {
    const r = request()
    const before = JSON.stringify(r)
    buildRefinePrompt(r)
    buildRefinePrompt(r)
    expect(JSON.stringify(r)).toBe(before)
  })
})

describe("buildRefineBatchPrompt", () => {
  test("un seul open : produit un prompt simple", () => {
    const state = addComment(EMPTY_COMMENT_STATE, comment({ id: "c-1" }))
    const prompt = buildRefineBatchPrompt({ artifactId: "a-1", entryFile: "x.html", comments: state })
    expect(prompt).toContain('data-unifia-id="path-0-2-1"')
    expect(prompt).toContain("make this less prominent")
  })

  test("zero open : produit un prompt neutre", () => {
    const prompt = buildRefineBatchPrompt({ artifactId: "a-1", entryFile: "x.html", comments: EMPTY_COMMENT_STATE })
    expect(prompt).toContain("(no open comments)")
  })

  test("plusieurs open : produit N sections numérotées", () => {
    let state = addComment(EMPTY_COMMENT_STATE, comment({ id: "c-1", elementId: "el-A", note: "fix A" }))
    state = addComment(state, comment({ id: "c-2", elementId: "el-B", note: "fix B" }))
    state = addComment(state, comment({ id: "c-3", elementId: "el-C", note: "fix C" }))
    const prompt = buildRefineBatchPrompt({ artifactId: "a-1", entryFile: "x.html", comments: state })
    expect(prompt).toContain("[Modification 1/3]")
    expect(prompt).toContain("[Modification 2/3]")
    expect(prompt).toContain("[Modification 3/3]")
    expect(prompt).toContain('data-unifia-id="el-A"')
    expect(prompt).toContain('data-unifia-id="el-B"')
    expect(prompt).toContain('data-unifia-id="el-C"')
  })

  test("les commentaires sent sont exclus", () => {
    const sent = addComment(EMPTY_COMMENT_STATE, comment({ id: "c-1", status: "sent", elementId: "el-sent" }))
    const state = addComment(sent, comment({ id: "c-2", status: "open", elementId: "el-open" }))
    const prompt = buildRefineBatchPrompt({ artifactId: "a-1", entryFile: "x.html", comments: state })
    expect(prompt).not.toContain("el-sent")
    expect(prompt).toContain("el-open")
  })

  test("l'ordre est celui de openComments (createdAt puis id)", () => {
    let state = addComment(EMPTY_COMMENT_STATE, comment({ id: "c-3", elementId: "el-C", createdAt: "2026-08-18T10:00:03.000Z" }))
    state = addComment(state, comment({ id: "c-1", elementId: "el-A", createdAt: "2026-08-18T10:00:01.000Z" }))
    state = addComment(state, comment({ id: "c-2", elementId: "el-B", createdAt: "2026-08-18T10:00:02.000Z" }))
    const prompt = buildRefineBatchPrompt({ artifactId: "a-1", entryFile: "x.html", comments: state })
    const posA = prompt.indexOf("el-A")
    const posB = prompt.indexOf("el-B")
    const posC = prompt.indexOf("el-C")
    expect(posA).toBeLessThan(posB)
    expect(posB).toBeLessThan(posC)
  })
})

describe("canSend", () => {
  test("un commentaire open peut être envoyé", () => {
    expect(canSend(comment({ status: "open" }))).toBe(true)
  })

  test("un commentaire sent ne peut PAS être renvoyé (déjà appliqué)", () => {
    expect(canSend(comment({ status: "sent" }))).toBe(false)
  })

  test("un commentaire resolved ne peut pas être envoyé via ce pipeline (c'est l'agent qui l'a résolu)", () => {
    expect(canSend(comment({ status: "resolved" }))).toBe(false)
  })
})
