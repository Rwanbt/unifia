/* SPDX-License-Identifier: MIT */
// Strings for the Design studio's tool panel and actions (ADR-085 amendment).
// Kept beside the main dictionaries, like design-artifact.ts, because en.ts and
// fr.ts are past the file-size ceiling.
//
// Every locale in @/context/language's Locale type owns a module under
// ./design-studio-tools/, so no locale falls back to English any more. Each
// module is typed against DesignStudioToolsKey, which turns a missing key into
// a compile error instead of a silent fallback.

import type { Locale } from "@/context/language"
import { ar } from "./design-studio-tools/ar"
import { br } from "./design-studio-tools/br"
import { bs } from "./design-studio-tools/bs"
import { da } from "./design-studio-tools/da"
import { de } from "./design-studio-tools/de"
import { es } from "./design-studio-tools/es"
import { ja } from "./design-studio-tools/ja"
import { ko } from "./design-studio-tools/ko"
import { no } from "./design-studio-tools/no"
import { pl } from "./design-studio-tools/pl"
import { ru } from "./design-studio-tools/ru"
import { th } from "./design-studio-tools/th"
import { tr } from "./design-studio-tools/tr"
import type { DesignStudioToolsDict, DesignStudioToolsKey } from "./design-studio-tools/types"
import { zh } from "./design-studio-tools/zh"
import { zht } from "./design-studio-tools/zht"

export type { DesignStudioToolsDict, DesignStudioToolsKey }

const en: DesignStudioToolsDict = {
  "panel.inspect": "Inspect",
  "panel.modify": "Modify",
  "panel.history": "History",
  "panel.audit": "Audit",
  "panel.close": "Close panel",
  "props.none": "Select one element to see its properties.",
  "props.many": "{count} elements selected. Select one to edit it.",
  "props.type": "Type",
  "props.name": "Name",
  "props.x": "X",
  "props.y": "Y",
  "props.width": "Width",
  "props.height": "Height",
  "props.rotation": "Rotation",
  "props.fill": "Fill",
  "props.stroke": "Stroke",
  "props.strokeWidth": "Stroke width",
  "props.opacity": "Opacity",
  "props.text": "Text",
  "props.contrast": "Contrast",
  "props.locked": "Locked: unlock it in the layers to edit.",
  "history.empty": "No changes yet.",
  "history.current": "Current state",
  "history.step": "Step {index} · {count} elements",
  "history.restore": "Restore",
  "audit.clean": "No issues found.",
  "audit.count": "{count} issue(s)",
  "audit.invalid-document": "The document does not validate: {detail}",
  "audit.low-contrast": "Text contrast {detail}:1 is below 4.5:1 (WCAG AA)",
  "audit.hidden": "Hidden element",
  "audit.unnamed": "Element without a name",
  "audit.empty-text": "Empty text",
  "audit.off-page": "Outside every page",
  "audit.tiny": "Smaller than 4 px",
  "format.title": "Page format",
  "format.desktop": "Desktop · 1440×900",
  "format.tablet": "Tablet · 768×1024",
  "format.mobile": "Mobile · 390×844",
  "format.applied": "Page resized to {name}",
  "format.created": "Page added: {name}",
  "page.actions": "Page actions",
  "page.rename": "Rename",
  "page.duplicate": "Duplicate",
  "page.delete": "Delete",
  "page.canvas": "Whole canvas",
  "vector.done": "Converted to an editable path",
  "vector.unsupported": "Select a rectangle, an ellipse or a line to convert it",
  "capture.done": "Canvas captured as PNG",
  "share.copied": "Design copied to the clipboard",
  "share.shared": "Design shared",
  "share.failed": "Sharing failed: {message}",
  "delete.label": "Delete",
  "delete.locked": "Locked elements cannot be deleted",
  "props.font": "Font",
  "props.fontSize": "Size",
  "props.align": "Alignment",
  "align.left": "Left",
  "align.center": "Center",
  "align.right": "Right",
  "text.placeholder": "Text",
}

const fr: DesignStudioToolsDict = {
  "panel.inspect": "Inspecter",
  "panel.modify": "Modifier",
  "panel.history": "Historique",
  "panel.audit": "Audit",
  "panel.close": "Fermer le panneau",
  "props.none": "Sélectionnez un élément pour voir ses propriétés.",
  "props.many": "{count} éléments sélectionnés. Sélectionnez-en un pour le modifier.",
  "props.type": "Type",
  "props.name": "Nom",
  "props.x": "X",
  "props.y": "Y",
  "props.width": "Largeur",
  "props.height": "Hauteur",
  "props.rotation": "Rotation",
  "props.fill": "Remplissage",
  "props.stroke": "Contour",
  "props.strokeWidth": "Épaisseur",
  "props.opacity": "Opacité",
  "props.text": "Texte",
  "props.contrast": "Contraste",
  "props.locked": "Verrouillé : déverrouillez-le dans les calques pour le modifier.",
  "history.empty": "Aucune modification pour l'instant.",
  "history.current": "État actuel",
  "history.step": "Étape {index} · {count} éléments",
  "history.restore": "Restaurer",
  "audit.clean": "Aucun problème trouvé.",
  "audit.count": "{count} problème(s)",
  "audit.invalid-document": "Le document n'est pas valide : {detail}",
  "audit.low-contrast": "Contraste du texte {detail}:1 inférieur à 4,5:1 (WCAG AA)",
  "audit.hidden": "Élément masqué",
  "audit.unnamed": "Élément sans nom",
  "audit.empty-text": "Texte vide",
  "audit.off-page": "Hors de toute page",
  "audit.tiny": "Plus petit que 4 px",
  "format.title": "Format de page",
  "format.desktop": "Ordinateur · 1440×900",
  "format.tablet": "Tablette · 768×1024",
  "format.mobile": "Mobile · 390×844",
  "format.applied": "Page redimensionnée : {name}",
  "format.created": "Page ajoutée : {name}",
  "page.actions": "Actions de page",
  "page.rename": "Renommer",
  "page.duplicate": "Dupliquer",
  "page.delete": "Supprimer",
  "page.canvas": "Canevas entier",
  "vector.done": "Converti en tracé modifiable",
  "vector.unsupported": "Sélectionnez un rectangle, une ellipse ou une ligne à convertir",
  "capture.done": "Canevas capturé en PNG",
  "share.copied": "Design copié dans le presse-papiers",
  "share.shared": "Design partagé",
  "share.failed": "Échec du partage : {message}",
  "delete.label": "Supprimer",
  "delete.locked": "Les éléments verrouillés ne peuvent pas être supprimés",
  "props.font": "Police",
  "props.fontSize": "Taille",
  "props.align": "Alignement",
  "align.left": "Gauche",
  "align.center": "Centre",
  "align.right": "Droite",
  "text.placeholder": "Texte",
}

export const dicts: Record<Locale, DesignStudioToolsDict> = {
  en,
  zh,
  zht,
  ko,
  de,
  es,
  fr,
  da,
  ja,
  pl,
  ru,
  ar,
  no,
  br,
  th,
  bs,
  tr,
}

export function tStudioTools(locale: Locale, key: DesignStudioToolsKey, params?: Record<string, string | number>): string {
  const template = dicts[locale][key]
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (params[name] === undefined ? match : String(params[name])))
}
