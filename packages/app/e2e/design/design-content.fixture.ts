/* SPDX-License-Identifier: MIT */

// Test-only canonical Canvas document, persisted through the real file SDK.
// The default Design workspace renders this file (NOT listArtifacts).
export const DESIGN_CANVAS_FILE = ".unifia/design/canvas.design.json"

export function visualDocument(fill: string): string {
  return JSON.stringify({
    schemaVersion: 2,
    id: "canvas",
    name: "RC1-729 seeded studio",
    rootIds: ["rc1-729-shape", "rc1-729-label"],
    nodes: {
      "rc1-729-shape": {
        id: "rc1-729-shape",
        name: "RC1 729 Color Surface",
        type: "rectangle",
        parentId: null,
        visible: true,
        locked: false,
        transform: { x: 52, y: 58, width: 240, height: 140, rotation: 0 },
        style: { fill },
      },
      "rc1-729-label": {
        id: "rc1-729-label",
        name: "RC1 729 Layer Text",
        type: "text",
        text: "Real Design Studio Content",
        parentId: null,
        visible: true,
        locked: false,
        transform: { x: 64, y: 94, width: 195, height: 36, rotation: 0 },
        style: { fill: "#ffffff" },
      },
    },
  })
}