/* SPDX-License-Identifier: MIT */
// Copyright (c) 2026 Unifia contributors
//
// Strings for design-artifact-tab.tsx and design-toolbar.tsx.
// packages/app/src/i18n/en.ts and fr.ts are already past the AGENTS.md
// 1500 LOC ceiling, so these keys live here instead (same reasoning as
// packages/app/src/i18n/home.ts).
//
// Tracked in packages/app/src/i18n/parity.test.ts's FRENCH_UI_WORD guard
// comment as known debt ("the rest of the design-* family ... still
// carries French titles/status messages; widening this guard requires
// clearing them first"): both files mixed hardcoded French (added first)
// and hardcoded English (added later, in the export/comment/snapshot
// controls) in the same JSX, so a French-locale user saw some controls in
// French and others in English, and vice versa for an English-locale user.
// This clears both files; the guard can be widened to include them in a
// follow-up once every file in that family is clear.

import type { Locale } from "@/context/language"

export type DesignArtifactKey =
  | "toolbar.comments.tooltip"
  | "toolbar.comments.label"
  | "toolbar.exportHtml.button"
  | "toolbar.exportHtml.exporting"
  | "toolbar.exportHtml.tooltip"
  | "toolbar.exportPdf.button"
  | "toolbar.exportPdf.tooltip"
  | "toolbar.export.failed"
  | "toolbar.snapshot.tooltip"
  | "toolbar.snapshot.button"
  | "toolbar.snapshot.capturing"
  | "toolbar.snapshot.download"
  | "toolbar.snapshot.copy.tooltip"
  | "toolbar.snapshot.copy.idle"
  | "toolbar.snapshot.copy.copying"
  | "toolbar.snapshot.error"
  | "artifact.copied"
  | "artifact.select.tooltip"
  | "artifact.select.active"
  | "artifact.select.idle"
  | "artifact.annotate.tooltip"
  | "artifact.annotate.active"
  | "artifact.annotate.idle"
  | "artifact.annotate.undo"
  | "artifact.annotate.clear"
  | "artifact.edit.tooltip"
  | "artifact.edit.active"
  | "artifact.edit.idle"
  | "artifact.present.label"
  | "artifact.present.inTab"
  | "artifact.present.fullscreen"
  | "artifact.present.newTab"
  | "artifact.present.close"
  | "artifact.present.closeTooltip"
  | "artifact.share.tooltip"
  | "artifact.share.minting"
  | "artifact.share.idle"
  | "artifact.connectionError"
  | "artifact.error.shareLinkFailed"
  | "artifact.error.editSaveFailed"
  | "artifact.error.annotationsLoadFailed"
  | "artifact.error.annotationsSaveFailed"
  | "artifact.error.htmlExportFailed"
  | "artifact.error.popupBlocked"
  | "artifact.error.presentLinkFailed"

type DesignArtifactDict = Record<DesignArtifactKey, string>

const en: DesignArtifactDict = {
  "toolbar.comments.tooltip": "Show or hide the comments panel",
  "toolbar.comments.label": "Comments",
  "toolbar.exportHtml.button": "Export HTML",
  "toolbar.exportHtml.exporting": "Exporting…",
  "toolbar.exportHtml.tooltip": "Inline CSS, scripts, and images into a single self-contained HTML file",
  "toolbar.exportPdf.button": "Export PDF",
  "toolbar.exportPdf.tooltip": "Build a PDF from the current page captures",
  "toolbar.export.failed": "export failed",
  "toolbar.snapshot.tooltip": "Sends a unifia:snapshot message to the iframe to get a PNG image of the render",
  "toolbar.snapshot.button": "Capture PNG",
  "toolbar.snapshot.capturing": "Capturing…",
  "toolbar.snapshot.download": "download {size}",
  "toolbar.snapshot.copy.tooltip": "Copy the image to the clipboard",
  "toolbar.snapshot.copy.idle": "Copy",
  "toolbar.snapshot.copy.copying": "Copying…",
  "toolbar.snapshot.error": "failed: {error}",
  "artifact.copied": "Copied!",
  "artifact.select.tooltip": "Arms the selection bridge: hover to highlight, click to target an element",
  "artifact.select.active": "Selection active…",
  "artifact.select.idle": "Select an element",
  "artifact.annotate.tooltip": "Draw freely over the render",
  "artifact.annotate.active": "Annotation active…",
  "artifact.annotate.idle": "Annotate",
  "artifact.annotate.undo": "Undo stroke",
  "artifact.annotate.clear": "Clear",
  "artifact.edit.tooltip": "Click an element in the render to edit its text directly",
  "artifact.edit.active": "Editing active…",
  "artifact.edit.idle": "Edit",
  "artifact.present.label": "Present:",
  "artifact.present.inTab": "In tab",
  "artifact.present.fullscreen": "Fullscreen",
  "artifact.present.newTab": "New tab",
  "artifact.present.close": "Close",
  "artifact.present.closeTooltip": "Close (Esc)",
  "artifact.share.tooltip": "Generates a signed link (5 minutes) and copies it to the clipboard",
  "artifact.share.minting": "Link…",
  "artifact.share.idle": "Share link",
  "artifact.connectionError": "Connection lost — the preview stays frozen on the last received state. ",
  "artifact.error.shareLinkFailed": "share link could not be created",
  "artifact.error.editSaveFailed": "manual edit could not be saved",
  "artifact.error.annotationsLoadFailed": "annotations could not be loaded",
  "artifact.error.annotationsSaveFailed": "annotations could not be saved",
  "artifact.error.htmlExportFailed": "html export failed",
  "artifact.error.popupBlocked": "popup blocked — allow popups to export as PDF",
  "artifact.error.presentLinkFailed": "present link could not be created",
}

const fr: DesignArtifactDict = {
  "toolbar.comments.tooltip": "Afficher ou masquer le panneau de commentaires",
  "toolbar.comments.label": "Commentaires",
  "toolbar.exportHtml.button": "Exporter en HTML",
  "toolbar.exportHtml.exporting": "Export en cours…",
  "toolbar.exportHtml.tooltip": "Intègre le CSS, les scripts et les images dans un seul fichier HTML autonome",
  "toolbar.exportPdf.button": "Exporter en PDF",
  "toolbar.exportPdf.tooltip": "Génère un PDF à partir des captures de la page actuelle",
  "toolbar.export.failed": "échec de l'export",
  "toolbar.snapshot.tooltip": "Envoie un message unifia:snapshot à l'iframe pour obtenir une image PNG du rendu",
  "toolbar.snapshot.button": "Capture PNG",
  "toolbar.snapshot.capturing": "Capture…",
  "toolbar.snapshot.download": "télécharger {size}",
  "toolbar.snapshot.copy.tooltip": "Copier l'image dans le presse-papiers",
  "toolbar.snapshot.copy.idle": "Copier",
  "toolbar.snapshot.copy.copying": "Copie…",
  "toolbar.snapshot.error": "échec : {error}",
  "artifact.copied": "Copié !",
  "artifact.select.tooltip": "Arme le pont de sélection : survole pour surligner, clique pour cibler un élément",
  "artifact.select.active": "Sélection active…",
  "artifact.select.idle": "Sélectionner un élément",
  "artifact.annotate.tooltip": "Dessine librement par-dessus le rendu",
  "artifact.annotate.active": "Annotation active…",
  "artifact.annotate.idle": "Annoter",
  "artifact.annotate.undo": "Annuler le trait",
  "artifact.annotate.clear": "Effacer",
  "artifact.edit.tooltip": "Clique un élément du rendu pour éditer son texte directement",
  "artifact.edit.active": "Modification active…",
  "artifact.edit.idle": "Modifier",
  "artifact.present.label": "Présenter :",
  "artifact.present.inTab": "Dans l'onglet",
  "artifact.present.fullscreen": "Plein écran",
  "artifact.present.newTab": "Nouvel onglet",
  "artifact.present.close": "Fermer",
  "artifact.present.closeTooltip": "Fermer (Échap)",
  "artifact.share.tooltip": "Génère un lien signé (5 minutes) et le copie dans le presse-papiers",
  "artifact.share.minting": "Lien…",
  "artifact.share.idle": "Lien de partage",
  "artifact.connectionError": "Connexion perdue — l'aperçu reste figé sur le dernier état reçu. ",
  "artifact.error.shareLinkFailed": "le lien de partage n'a pas pu être créé",
  "artifact.error.editSaveFailed": "la modification n'a pas pu être enregistrée",
  "artifact.error.annotationsLoadFailed": "les annotations n'ont pas pu être chargées",
  "artifact.error.annotationsSaveFailed": "les annotations n'ont pas pu être enregistrées",
  "artifact.error.htmlExportFailed": "échec de l'export HTML",
  "artifact.error.popupBlocked": "popup bloquée — autorisez les popups pour exporter en PDF",
  "artifact.error.presentLinkFailed": "le lien de présentation n'a pas pu être créé",
}

const dicts: Partial<Record<Locale, DesignArtifactDict>> = { en, fr }

export function tDesignArtifact(
  locale: Locale,
  key: DesignArtifactKey,
  params?: Record<string, string>,
): string {
  const template = dicts[locale]?.[key] ?? en[key]
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => params[name] ?? match)
}
