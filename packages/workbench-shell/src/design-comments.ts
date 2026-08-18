/* SPDX-License-Identifier: MIT */

/**
 * P19 — Modèle pur des commentaires Design.
 *
 * Un commentaire est une note attachée à un élément identifié par son
 * `data-unifia-id` (cf. P18). Trois statuts :
 * - "open"     : créé mais pas encore envoyé à l'agent (P20 s'en chargera)
 * - "sent"     : envoyé à l'agent ; immuable (P20)
 * - "resolved" : l'agent a appliqué la modif ; conservé pour traçabilité
 *
 * Le module est PUR : toutes les fonctions prennent un `CommentState`
 * et en retournent un nouveau. Aucune dépendance DOM, aucune I/O. La
 * persistance (P19 §"Persistance") est déléguée à un store IndexedDB
 * câblé en aval (cf. design-draft.ts pour le pattern).
 *
 * Règles (testées dans design-comments.test.ts) :
 * - `addComment` : ajoute sans mutation ; refuse un doublon d'id
 * - `updateComment` : refuse si status === "sent" (immutable post-envoi)
 * - `removeComment` : retire, ordre préservé
 * - `commentsForElement` : filtre par elementId, ordre stable (createdAt, id)
 * - `openComments` : filtre par status === "open", ordre stable
 */

export type CommentStatus = "open" | "sent" | "resolved"

export type DesignComment = {
  id: string
  artifactId: string
  elementId: string
  note: string
  status: CommentStatus
  /** ISO 8601 (createdAt sert de tie-breaker pour l'ordre stable). */
  createdAt: string
}

export type CommentState = {
  comments: readonly DesignComment[]
}

export const EMPTY_COMMENT_STATE: CommentState = { comments: [] }

/**
 * Compare deux commentaires par (createdAt, id) — utilisé partout
 * où on doit garantir un ordre stable.
 */
function compareComments(a: DesignComment, b: DesignComment): number {
  if (a.createdAt < b.createdAt) return -1
  if (a.createdAt > b.createdAt) return 1
  if (a.id < b.id) return -1
  if (a.id > b.id) return 1
  return 0
}

/**
 * Ajoute un commentaire à la fin du tableau (l'ordre est ensuite
 * stabilisé par sortByStable). Si un commentaire avec le même `id`
 * existe déjà, retourne l'état inchangé — la collision d'id est
 * une erreur du caller, pas un cas à masquer.
 */
export function addComment(state: CommentState, comment: DesignComment): CommentState {
  if (state.comments.some((c) => c.id === comment.id)) return state
  return { comments: sortByStable([...state.comments, comment]) }
}

/**
 * Met à jour la note d'un commentaire. Refuse si le commentaire est
 * en `sent` (immutable après envoi) ou s'il n'existe pas — retourne
 * l'état inchangé dans les deux cas.
 */
export function updateComment(state: CommentState, id: string, note: string): CommentState {
  const target = state.comments.find((c) => c.id === id)
  if (!target) return state
  if (target.status === "sent") return state
  const next = state.comments.map((c) => (c.id === id ? { ...c, note } : c))
  return { comments: sortByStable(next) }
}

/**
 * Retire un commentaire. Si l'id n'existe pas, retourne l'état inchangé.
 */
export function removeComment(state: CommentState, id: string): CommentState {
  if (!state.comments.some((c) => c.id === id)) return state
  return { comments: state.comments.filter((c) => c.id !== id) }
}

/**
 * Liste les commentaires d'un élément, dans l'ordre (createdAt, id).
 */
export function commentsForElement(state: CommentState, elementId: string): readonly DesignComment[] {
  return sortByStable(state.comments.filter((c) => c.elementId === elementId))
}

/**
 * Liste les commentaires encore "open" (pas envoyés, pas résolus),
 * dans l'ordre (createdAt, id).
 */
export function openComments(state: CommentState): readonly DesignComment[] {
  return sortByStable(state.comments.filter((c) => c.status === "open"))
}

/**
 * Marque un commentaire comme "sent" (transition open → sent).
 * Refuse si l'id n'existe pas, ou si le statut n'est pas "open".
 * Une fois `sent`, le commentaire est immutable.
 */
export function markSent(state: CommentState, id: string): CommentState {
  const target = state.comments.find((c) => c.id === id)
  if (!target) return state
  if (target.status !== "open") return state
  const next = state.comments.map((c) => (c.id === id ? { ...c, status: "sent" as CommentStatus } : c))
  return { comments: next }
}

/**
 * Marque un commentaire "resolved" — utilisé par P20 quand l'agent a
 * confirmé l'application de la modification.
 */
export function markResolved(state: CommentState, id: string): CommentState {
  const target = state.comments.find((c) => c.id === id)
  if (!target) return state
  if (target.status === "sent") return state
  const next = state.comments.map((c) => (c.id === id ? { ...c, status: "resolved" as CommentStatus } : c))
  return { comments: next }
}

function sortByStable(comments: readonly DesignComment[]): DesignComment[] {
  return [...comments].sort(compareComments)
}

/**
 * Génère un id unique pour un commentaire. Tiré de crypto.randomUUID()
 * quand dispo (modern browsers, Bun), fallback sur timestamp+random
 * sinon. Pure : pas d'I/O, deterministic pour un même univers.
 */
export function newCommentId(now: number = Date.now(), rand: number = Math.random()): string {
  const ts = now.toString(36)
  const r = Math.floor(rand * 1e9).toString(36)
  return `c-${ts}-${r}`
}
