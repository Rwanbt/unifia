/* SPDX-License-Identifier: MIT */

/**
 * Pure helpers shared by `WorkbenchThread` and any future thread surface
 * (e.g. an in-tab thread inside the Open Design tabs bar).
 *
 * WHY split: `WorkbenchThread` is a Solid component that depends on the app
 * context tree (`useSync`, `useLanguage`, `useSDK`, `useMode`). Pure
 * formatting and suggestion selection must be unit-testable without that
 * tree, and `WorkbenchChat` already inlines the same text-extraction
 * logic — promoting it here kills the duplication without coupling the
 * helpers to a render layer.
 */

export type ThreadMessageRole = "user" | "assistant"

export type ThreadMessage = {
  id: string
  role: ThreadMessageRole
  text: string
}

export type NextStepSuggestion = {
  id: string
  label: string
  prompt: string
}

type PartLike = { type?: string; text?: string }

/**
 * Flatten a session message's parts to a single plain-text string. Mirrors
 * the contract `MessageEnvelope` already exposes through the SDK shim:
 * only the `text` part type carries user-visible content, everything else
 * (tool calls, snapshots, file attachments) is dropped from the thread.
 *
 * `parts` is the per-message parts map (`sync.data.part[messageId]`). The
 * field is optional on the shim to allow envelopes that arrive before
 * their parts, so callers should treat `undefined` as "no text yet".
 */
export function extractMessageText(parts: readonly PartLike[] | undefined): string {
  return (parts ?? [])
    .filter((part): part is { type: string; text: string } => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim()
}

/**
 * Static, mode-keyed next-step suggestions seeded into the thread footer.
 *
 * WHY static in v1: the workbench agent (Design / Automate) is not yet
 * wired to produce a live follow-up list. Seeding the card with curated
 * prompts keeps the affordance honest — the user can see what kind of
 * follow-up the thread expects — without inventing behaviour the agent
 * does not yet have. Once the agent is hooked, this becomes a
 * `Promise<NextStepSuggestion[]>` resolved from the session.
 */
export function selectNextStepSuggestions(mode: "work" | "design" | "automate"): readonly NextStepSuggestion[] {
  switch (mode) {
    case "work":
      return WORK_NEXT_STEPS
    case "design":
      return DESIGN_NEXT_STEPS
    case "automate":
      return AUTOMATE_NEXT_STEPS
  }
}

const WORK_NEXT_STEPS: readonly NextStepSuggestion[] = [
  {
    id: "work-summarize",
    label: "Résume l'état de l'espace de travail",
    prompt: "Résume l'état de l'espace de travail actuel et identifie la prochaine action sûre.",
  },
  {
    id: "work-list-files",
    label: "Liste les fichiers modifiés récemment",
    prompt: "Liste les fichiers modifiés au cours des 24 dernières heures dans cet espace de travail.",
  },
  {
    id: "work-artifacts",
    label: "Montre les artefacts persistés",
    prompt: "Quels artefacts ont été persistés et quelles versions sont disponibles ?",
  },
]

const DESIGN_NEXT_STEPS: readonly NextStepSuggestion[] = [
  {
    id: "design-iterate",
    label: "Itère sur la spec validée",
    prompt: "Propose trois variations sur la spec validée et applique celle qui respecte la charte.",
  },
  {
    id: "design-viewports",
    label: "Vérifie les trois fenêtres d'affichage",
    prompt: "Vérifie le rendu sur les trois fenêtres (desktop, tablette, mobile) et signale les débordements.",
  },
  {
    id: "design-export",
    label: "Exporte le rendu en SVG autonome",
    prompt: "Exporte le rendu courant en SVG autonome prêt à partager.",
  },
]

const AUTOMATE_NEXT_STEPS: readonly NextStepSuggestion[] = [
  {
    id: "automate-draft",
    label: "Propose un brouillon de workflow",
    prompt: "Propose un brouillon de workflow sûr pour la prochaine action approuvée.",
  },
  {
    id: "automate-list",
    label: "Liste les définitions disponibles",
    prompt: "Liste les définitions de workflow disponibles dans cet espace de travail.",
  },
  {
    id: "automate-approval",
    label: "Vérifie les portes d'approbation",
    prompt: "Décris les portes d'approbation de chaque définition de workflow active.",
  },
]
