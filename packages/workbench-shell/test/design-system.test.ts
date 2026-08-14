/* SPDX-License-Identifier: MIT */

import { createDesignSystemPickerRows, parseDesignSystemCatalog } from "../src/design-system.js"

const catalog = parseDesignSystemCatalog({ id: "unifia-system", name: "Unifia", version: "1.0.0", source: "workspace://design-system", tokens: { colors: { primary: "#ffffff" }, spacing: { gutter: 24 }, typography: { body: "Inter" } } })
if (catalog.tokens.spacing.gutter !== 24 || catalog.source !== "workspace://design-system") throw new Error("design system contract lost tokens/source")
const rows = createDesignSystemPickerRows([catalog, { ...catalog, id: "alpha-system", name: "Alpha" }], "unifia-system")
if (rows[0]?.id !== "alpha-system" || rows[1]?.selected !== true) throw new Error("design system picker was not sorted/selected")
let refused = false
try { parseDesignSystemCatalog({ ...catalog, source: "" }) } catch { refused = true }
if (!refused) throw new Error("design system parser accepted a missing source")
console.log("DesignSystem: 3/3 passed")
