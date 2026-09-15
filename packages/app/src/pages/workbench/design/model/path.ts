/* SPDX-License-Identifier: MIT */

import type { DesignPointV1 } from "./schema"

/**
 * Polyline subset of SVG path data (`M`/`L` only, absolute, uppercase).
 * That is exactly what the pen tool produces and what can be edited by
 * anchors; anything else (curves, relative commands, arcs) is refused so an
 * unsupported path is never silently mis-edited.
 */
export function parsePathPoints(d: string): DesignPointV1[] | undefined {
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g)
  if (!tokens || tokens.length < 5 || tokens[0] !== "M") return undefined
  const points: DesignPointV1[] = []
  let index = 1
  let command: "M" | "L" = "M"
  while (index < tokens.length) {
    const token = tokens[index]
    if (token === "M" || token === "L") {
      command = token
      index += 1
      continue
    }
    if (command === "M" && points.length > 0) return undefined
    const x = Number(token)
    const y = Number(tokens[index + 1])
    if (tokens[index + 1] === undefined || !Number.isFinite(x) || !Number.isFinite(y)) return undefined
    points.push({ x, y })
    index += 2
    command = "L"
  }
  return points.length >= 2 ? points : undefined
}

export function serializePathPoints(points: readonly DesignPointV1[]): string | undefined {
  if (points.length < 2) return undefined
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ")
}
