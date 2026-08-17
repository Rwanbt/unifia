/* SPDX-License-Identifier: MIT */

import { createDesignSpecPanelState } from "../src/design-spec.js"
import { test } from "bun:test"

test('design-spec.test', async () => {

let checks = 0
const check = (condition: boolean, message: string): void => { checks += 1; if (!condition) throw new Error(message) }

const valid = JSON.stringify({ id: "landing-page", version: "1.0.0", target: "design", title: "Landing", capabilities: ["workspace.read", "secret.read"], rules: [], tokens: { colors: { primary: "#ffffff" } } })
const inline = createDesignSpecPanelState({ kind: "inline", value: valid })
check(inline.spec?.id === "landing-page", "valid inline spec was not parsed")
check(inline.capabilities.granted.length === 0 && inline.capabilities.denied.length === 2, "spec capabilities were elevated")

const invalid = createDesignSpecPanelState({ kind: "file", path: "design/spec.json", value: '{\n  "id": "broken"\n}' })
check(invalid.source.kind === "file" && invalid.source.path === "design/spec.json", "file provenance was not preserved")
check(invalid.diagnostics.length === 1 && invalid.diagnostics[0]?.line === 1, "semantic diagnostics did not point to the source")

const malformed = createDesignSpecPanelState({ kind: "inline", value: '{\n  "id": ' })
check(malformed.diagnostics[0]?.line === 2 && malformed.diagnostics[0]?.column > 1, "JSON syntax diagnostic lost line/column")

console.log(`DesignSpecPanel: ${checks}/${checks} passed`)
})
