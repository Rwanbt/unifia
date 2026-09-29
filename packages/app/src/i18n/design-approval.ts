/* SPDX-License-Identifier: MIT */
// Copyright (c) 2026 Unifia contributors
//
// Strings for design-surface.tsx's ApprovalModal. packages/app/src/i18n/en.ts
// and fr.ts are already past the AGENTS.md 1500 LOC ceiling, so these keys
// live here instead (same reasoning as packages/app/src/i18n/home.ts).
//
// Same debt class as packages/app/src/i18n/design-artifact.ts: this modal
// hardcoded every string in French with no English variant at all, so an
// English-locale user saw "Approbation requise" / "Annuler" / "Refuser" no
// matter what.

import type { Locale } from "@/context/language"

export type DesignApprovalKey =
  | "title"
  | "description"
  | "expiredWarning"
  | "expiresAt"
  | "resolving"
  | "cancel"
  | "rerequest"
  | "deny"
  | "allow"

type DesignApprovalDict = Record<DesignApprovalKey, string>

const en: DesignApprovalDict = {
  title: "Approval required",
  description: "This operation requires approval ({capability}). The server is waiting for your decision before continuing.",
  expiredWarning: "The approval has expired. You can request a new one.",
  expiresAt: "Expires at: ",
  resolving: "Sending the decision to the server…",
  cancel: "Cancel",
  rerequest: "Request a new approval",
  deny: "Deny",
  allow: "Approve and retry",
}

const fr: DesignApprovalDict = {
  title: "Approbation requise",
  description: "Cette opération nécessite une approbation ({capability}). Le serveur attend votre décision avant de continuer.",
  expiredWarning: "L'approbation a expiré. Vous pouvez en demander une nouvelle.",
  expiresAt: "Expire à : ",
  resolving: "Envoi de la décision au serveur…",
  cancel: "Annuler",
  rerequest: "Demander une nouvelle approbation",
  deny: "Refuser",
  allow: "Approuver et réessayer",
}

const dicts: Partial<Record<Locale, DesignApprovalDict>> = { en, fr }

export function tDesignApproval(locale: Locale, key: DesignApprovalKey, params?: Record<string, string>): string {
  const template = dicts[locale]?.[key] ?? en[key]
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => params[name] ?? match)
}
