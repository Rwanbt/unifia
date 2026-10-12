/* SPDX-License-Identifier: MIT */

import type { NavSection } from "@/context/mode-navigation"
import type { DesignStudioCatalog } from "./studio-panel"

/**
 * The Design side panel: the canvas document being edited (the studio holds
 * one page per tab) and the design-system catalogues the workspace manifest
 * declares. Both are informational, so their rows are not buttons.
 */
export function designNavSections(input: { readonly pageName: string; readonly catalogs: readonly DesignStudioCatalog[] }): readonly NavSection[] {
  return [
    {
      id: "design.pages",
      titleKey: "sidebar.nav.pages",
      rows: [{ id: "page", glyph: "▧", label: input.pageName, active: true }],
    },
    {
      id: "design.system",
      titleKey: "sidebar.nav.designSystem",
      emptyKey: "design.studio.system.empty",
      rows: input.catalogs.map((catalog) => ({ id: catalog.id, glyph: "◇", label: `${catalog.name} ${catalog.version}` })),
    },
  ]
}
