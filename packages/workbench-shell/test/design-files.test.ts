/* SPDX-License-Identifier: MIT */

import { adaptDesignFiles, createDesignFilesPanelState } from "../src/design-files.js"

const page = { entries: [
  { path: "zeta.ts", kind: "file" as const, size: 1, modifiedAt: 2 },
  { path: "assets/logo.svg", kind: "file" as const, size: 2, modifiedAt: 3 },
  { path: "styles/theme.css", kind: "file" as const, size: 3, modifiedAt: 4 },
  { path: "components/Card.tsx", kind: "file" as const, size: 4, modifiedAt: 5 },
  { path: "components", kind: "directory" as const, size: 0, modifiedAt: 5 },
] }
const files = adaptDesignFiles(page)
if (files.length !== 4 || files[0]?.path !== "assets/logo.svg") throw new Error("design file adapter did not filter/sort files")
if (files.find((file) => file.path === "assets/logo.svg")?.kind !== "asset") throw new Error("asset kind was not inferred")
if (files.find((file) => file.path === "components/Card.tsx")?.kind !== "component") throw new Error("component kind was not inferred")
if (createDesignFilesPanelState(page, "missing.ts").selectedPath !== undefined) throw new Error("panel selected an absent file")
if (createDesignFilesPanelState(page, "styles/theme.css").selectedPath !== "styles/theme.css") throw new Error("panel did not preserve a valid selection")
console.log("DesignFiles: 5/5 passed")
