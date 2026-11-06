/* SPDX-License-Identifier: MIT */

import { inspectDesignDocument } from "../model/validation"
import type { DesignDocumentV1, DesignNodeId, DesignNodeV1 } from "../model/schema"
import { designPages } from "./studio-actions"

/**
 * The studio's Audit action: what a reviewer checks before hand-off, as pure
 * functions over the canonical document (owner directive 2026-11-03).
 */

export type DesignAuditFinding = {
  severity: "error" | "warning"
  code: "invalid-document" | "low-contrast" | "hidden" | "unnamed" | "empty-text" | "off-page" | "tiny"
  nodeId?: DesignNodeId
  detail?: string
}

function hexToRgb(color: string): [number, number, number] | undefined {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())
  if (!match) return undefined
  const hex = match[1]!.length === 3 ? match[1]!.replace(/./g, (c) => c + c) : match[1]!
  return [0, 2, 4].map((at) => Number.parseInt(hex.slice(at, at + 2), 16)) as [number, number, number]
}

function luminance([r, g, b]: [number, number, number]): number {
  const channel = (value: number) => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG 2.x contrast ratio, or undefined when a colour is not plain hex. */
export function contrastRatio(foreground: string, background: string): number | undefined {
  const a = hexToRgb(foreground)
  const b = hexToRgb(background)
  if (!a || !b) return undefined
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

const overlaps = (a: DesignNodeV1["transform"], b: DesignNodeV1["transform"]) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

/** The top-most filled shape under a node's centre, drawn before it. */
function backgroundFill(document: DesignDocumentV1, node: DesignNodeV1): string | undefined {
  const order = document.rootIds
  const index = order.indexOf(node.id)
  for (let at = (index < 0 ? order.length : index) - 1; at >= 0; at--) {
    const below = document.nodes[order[at]!]
    if (!below || !below.visible || !overlaps(below.transform, node.transform)) continue
    if (below.type === "frame") return "#ffffff"
    if ("style" in below && below.style?.fill) return below.style.fill
  }
  return "#ffffff"
}

/** Minimum size (px) a shape needs to be tappable / readable. */
const TINY_PX = 4

/**
 * Checks a document the way a reviewer would before hand-off: it parses, text
 * is readable (WCAG AA 4.5:1 against what is under it), nothing is accidentally
 * hidden, unnamed, empty, microscopic or lost outside every page.
 */
export function auditDesignDocument(document: DesignDocumentV1): DesignAuditFinding[] {
  const findings: DesignAuditFinding[] = []
  const inspection = inspectDesignDocument(document)
  if (!inspection.ok) findings.push({ severity: "error", code: "invalid-document", detail: inspection.issues[0] })
  const pages = designPages(document)
  for (const node of Object.values(document.nodes)) {
    if (!node.visible) findings.push({ severity: "warning", code: "hidden", nodeId: node.id })
    if (node.name.trim() === "") findings.push({ severity: "warning", code: "unnamed", nodeId: node.id })
    if (node.type === "text") {
      if (node.text.trim() === "") findings.push({ severity: "warning", code: "empty-text", nodeId: node.id })
      const ratio = contrastRatio(node.style?.fill ?? "#18181b", backgroundFill(document, node) ?? "#ffffff")
      if (ratio !== undefined && ratio < 4.5) {
        findings.push({ severity: "error", code: "low-contrast", nodeId: node.id, detail: ratio.toFixed(2) })
      }
    }
    if (node.type !== "line" && node.type !== "frame" && (node.transform.width < TINY_PX || node.transform.height < TINY_PX)) {
      findings.push({ severity: "warning", code: "tiny", nodeId: node.id })
    }
    if (pages.length > 0 && node.parentId === null && node.type !== "frame" && !pages.some((page) => overlaps(page.transform, node.transform))) {
      findings.push({ severity: "warning", code: "off-page", nodeId: node.id })
    }
  }
  return findings
}
