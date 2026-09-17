/* SPDX-License-Identifier: MIT */

import type { DesignPointV1 } from "./schema"

/**
 * Editable subset of SVG path data: one subpath, absolute commands `M`/`L`/
 * `C`/`Q` (uppercase). That is the pen's output plus the curves the canvas
 * can expose as handles; anything else (relative commands, arcs, smoothing
 * shortcuts, `Z`, multiple subpaths) is refused so an unsupported path is
 * never silently mis-edited.
 */
export type PathSegment =
  | { kind: "line"; to: DesignPointV1 }
  | { kind: "cubic"; control1: DesignPointV1; control2: DesignPointV1; to: DesignPointV1 }
  | { kind: "quad"; control: DesignPointV1; to: DesignPointV1 }

export type PathData = {
  start: DesignPointV1
  segments: readonly PathSegment[]
}

export type PathBounds = { x: number; y: number; width: number; height: number }

/** A draggable editing affordance: an on-path anchor or a Bezier control. */
export type PathHandle =
  | { kind: "anchor"; index: number }
  | { kind: "control"; index: number; which: "first" | "second" | "single" }

export type PathHandlePoint = {
  handle: PathHandle
  point: DesignPointV1
  /** The anchor this handle belongs to (the point itself for anchors). */
  anchor: DesignPointV1
}

const epsilon = 1e-9

export function parsePath(d: string): PathData | undefined {
  const entries = tokenize(d)
  if (!entries || entries.length === 0 || entries[0]?.command !== "M") return undefined
  let start: DesignPointV1 | undefined
  const segments: PathSegment[] = []
  for (const entry of entries) {
    if (entry.command === "M") {
      const points = readPoints(entry.numbers)
      if (start !== undefined || !points) return undefined
      const [head, ...rest] = points
      if (!head) return undefined
      start = head
      for (const point of rest) segments.push({ kind: "line", to: point })
      continue
    }
    if (entry.command === "L") {
      const points = readPoints(entry.numbers)
      if (!points) return undefined
      for (const point of points) segments.push({ kind: "line", to: point })
      continue
    }
    if (entry.command === "C") {
      if (entry.numbers.length === 0 || entry.numbers.length % 6 !== 0) return undefined
      for (let at = 0; at < entry.numbers.length; at += 6) {
        const control1 = readPoint(entry.numbers, at)
        const control2 = readPoint(entry.numbers, at + 2)
        const to = readPoint(entry.numbers, at + 4)
        if (!control1 || !control2 || !to) return undefined
        segments.push({ kind: "cubic", control1, control2, to })
      }
      continue
    }
    if (entry.numbers.length === 0 || entry.numbers.length % 4 !== 0) return undefined
    for (let at = 0; at < entry.numbers.length; at += 4) {
      const control = readPoint(entry.numbers, at)
      const to = readPoint(entry.numbers, at + 2)
      if (!control || !to) return undefined
      segments.push({ kind: "quad", control, to })
    }
  }
  if (!start || segments.length === 0) return undefined
  return { start, segments }
}

export function serializePath(data: PathData): string {
  const parts = [`M ${data.start.x} ${data.start.y}`]
  for (const segment of data.segments) {
    if (segment.kind === "line") {
      parts.push(`L ${segment.to.x} ${segment.to.y}`)
      continue
    }
    if (segment.kind === "cubic") {
      parts.push(
        `C ${segment.control1.x} ${segment.control1.y} ${segment.control2.x} ${segment.control2.y} ${segment.to.x} ${segment.to.y}`,
      )
      continue
    }
    parts.push(`Q ${segment.control.x} ${segment.control.y} ${segment.to.x} ${segment.to.y}`)
  }
  return parts.join(" ")
}

export function translatePath(data: PathData, delta: DesignPointV1): PathData {
  const move = (point: DesignPointV1) => ({ x: point.x + delta.x, y: point.y + delta.y })
  return {
    start: move(data.start),
    segments: data.segments.map((segment) => {
      if (segment.kind === "line") return { kind: "line", to: move(segment.to) }
      if (segment.kind === "cubic") {
        return { kind: "cubic", control1: move(segment.control1), control2: move(segment.control2), to: move(segment.to) }
      }
      return { kind: "quad", control: move(segment.control), to: move(segment.to) }
    }),
  }
}

/**
 * Tight bounds: curve extrema are solved instead of using the control hull,
 * so the bounding-box transform never claims space the curve does not fill.
 */
export function pathBounds(data: PathData): PathBounds | undefined {
  if (data.segments.length === 0) return undefined
  const xs = [data.start.x]
  const ys = [data.start.y]
  let from = data.start
  for (const segment of data.segments) {
    if (!isFinitePoint(from) || !isFinitePoint(segment.to)) return undefined
    xs.push(segment.to.x)
    ys.push(segment.to.y)
    if (segment.kind === "cubic") {
      if (!isFinitePoint(segment.control1) || !isFinitePoint(segment.control2)) return undefined
      for (const t of cubicExtrema(from.x, segment.control1.x, segment.control2.x, segment.to.x)) {
        xs.push(cubicAt(from.x, segment.control1.x, segment.control2.x, segment.to.x, t))
      }
      for (const t of cubicExtrema(from.y, segment.control1.y, segment.control2.y, segment.to.y)) {
        ys.push(cubicAt(from.y, segment.control1.y, segment.control2.y, segment.to.y, t))
      }
    }
    if (segment.kind === "quad") {
      if (!isFinitePoint(segment.control)) return undefined
      const tx = quadExtremum(from.x, segment.control.x, segment.to.x)
      if (tx !== undefined) xs.push(quadAt(from.x, segment.control.x, segment.to.x, tx))
      const ty = quadExtremum(from.y, segment.control.y, segment.to.y)
      if (ty !== undefined) ys.push(quadAt(from.y, segment.control.y, segment.to.y, ty))
    }
    from = segment.to
  }
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY }
}

export function pathHandles(data: PathData): PathHandlePoint[] {
  const handles: PathHandlePoint[] = []
  let previous = data.start
  const push = (handle: PathHandle, point: DesignPointV1, anchor: DesignPointV1): void => {
    handles.push({ handle, point, anchor })
  }
  push({ kind: "anchor", index: 0 }, data.start, data.start)
  data.segments.forEach((segment, index) => {
    if (segment.kind === "cubic") {
      push({ kind: "control", index, which: "first" }, segment.control1, previous)
      push({ kind: "control", index, which: "second" }, segment.control2, segment.to)
    }
    if (segment.kind === "quad") {
      push({ kind: "control", index, which: "single" }, segment.control, previous)
    }
    push({ kind: "anchor", index: index + 1 }, segment.to, segment.to)
    previous = segment.to
  })
  return handles
}

/**
 * Anchor drags translate the cubic controls attached to the moved anchor so
 * tangents survive the edit. A quad carries one shared control: translating
 * it with either endpoint would distort the other side, so it stays put.
 */
export function movePathHandle(data: PathData, handle: PathHandle, to: DesignPointV1): PathData {
  const from = handlePoint(data, handle)
  if (!from) return data
  if (handle.kind === "control") {
    return {
      start: data.start,
      segments: data.segments.map((segment, index) => {
        if (index !== handle.index) return segment
        if (segment.kind === "cubic" && handle.which === "first") return { ...segment, control1: to }
        if (segment.kind === "cubic" && handle.which === "second") return { ...segment, control2: to }
        if (segment.kind === "quad" && handle.which === "single") return { ...segment, control: to }
        return segment
      }),
    }
  }
  const delta = { x: to.x - from.x, y: to.y - from.y }
  const moved = (point: DesignPointV1) => ({ x: point.x + delta.x, y: point.y + delta.y })
  return {
    start: handle.index === 0 ? to : data.start,
    segments: data.segments.map((segment, index) => {
      const ends = index === handle.index - 1
      const starts = index === handle.index
      if (segment.kind === "cubic") {
        return {
          ...segment,
          control1: starts ? moved(segment.control1) : segment.control1,
          control2: ends ? moved(segment.control2) : segment.control2,
          to: ends ? moved(segment.to) : segment.to,
        }
      }
      return { ...segment, to: ends ? moved(segment.to) : segment.to }
    }),
  }
}

function handlePoint(data: PathData, handle: PathHandle): DesignPointV1 | undefined {
  if (handle.kind === "anchor") {
    if (handle.index === 0) return data.start
    return data.segments[handle.index - 1]?.to
  }
  const segment = data.segments[handle.index]
  if (!segment) return undefined
  if (segment.kind === "cubic" && handle.which === "first") return segment.control1
  if (segment.kind === "cubic" && handle.which === "second") return segment.control2
  if (segment.kind === "quad" && handle.which === "single") return segment.control
  return undefined
}

type ParsedCommand = { command: "M" | "L" | "C" | "Q"; numbers: number[] }

function tokenize(d: string): ParsedCommand[] | undefined {
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g)
  if (!tokens) return undefined
  const entries: ParsedCommand[] = []
  for (const token of tokens) {
    if (token === "M" || token === "L" || token === "C" || token === "Q") {
      entries.push({ command: token, numbers: [] })
      continue
    }
    const last = entries[entries.length - 1]
    if (!last) return undefined
    const value = Number(token)
    if (!Number.isFinite(value)) return undefined
    last.numbers.push(value)
  }
  return entries
}

function readPoint(numbers: readonly number[], at: number): DesignPointV1 | undefined {
  const x = numbers[at]
  const y = numbers[at + 1]
  return x === undefined || y === undefined ? undefined : { x, y }
}

function readPoints(numbers: readonly number[]): DesignPointV1[] | undefined {
  if (numbers.length === 0 || numbers.length % 2 !== 0) return undefined
  const points: DesignPointV1[] = []
  for (let at = 0; at < numbers.length; at += 2) {
    const point = readPoint(numbers, at)
    if (!point) return undefined
    points.push(point)
  }
  return points
}

function isFinitePoint(point: DesignPointV1): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y)
}

function cubicAt(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const rest = 1 - t
  return p0 * rest ** 3 + 3 * p1 * rest ** 2 * t + 3 * p2 * rest * t ** 2 + p3 * t ** 3
}

function quadAt(p0: number, p1: number, p2: number, t: number): number {
  const rest = 1 - t
  return p0 * rest ** 2 + 2 * p1 * rest * t + p2 * t ** 2
}

/** Interior parameters where a cubic segment reaches a coordinate extremum. */
function cubicExtrema(p0: number, p1: number, p2: number, p3: number): number[] {
  const a = p3 - 3 * p2 + 3 * p1 - p0
  const b = 2 * (p0 - 2 * p1 + p2)
  const c = p1 - p0
  const roots: number[] = []
  if (Math.abs(a) < epsilon) {
    if (Math.abs(b) >= epsilon) roots.push(-c / b)
  } else {
    const disc = b * b - 4 * a * c
    if (disc >= 0) {
      const root = Math.sqrt(disc)
      roots.push((-b + root) / (2 * a), (-b - root) / (2 * a))
    }
  }
  return roots.filter((t) => t > 0 && t < 1)
}

/** Interior parameter where a quadratic segment reaches a coordinate extremum. */
function quadExtremum(p0: number, p1: number, p2: number): number | undefined {
  const denominator = p0 - 2 * p1 + p2
  if (Math.abs(denominator) < epsilon) return undefined
  const t = (p0 - p1) / denominator
  return t > 0 && t < 1 ? t : undefined
}
