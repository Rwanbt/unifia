/* SPDX-License-Identifier: MIT */

export type DesignViewport = {
  panX: number
  panY: number
  zoom: number
}

export type DesignViewportPoint = { x: number; y: number }

/** Editor policy, not document data: changing it needs no migration. */
export const designZoomLimits = { min: 0.25, max: 4 } as const

export function clampZoom(zoom: number): number {
  return Math.min(designZoomLimits.max, Math.max(designZoomLimits.min, zoom))
}

export function screenToWorld(viewport: DesignViewport, point: DesignViewportPoint): DesignViewportPoint {
  return { x: (point.x - viewport.panX) / viewport.zoom, y: (point.y - viewport.panY) / viewport.zoom }
}

export function worldToScreen(viewport: DesignViewport, point: DesignViewportPoint): DesignViewportPoint {
  return { x: point.x * viewport.zoom + viewport.panX, y: point.y * viewport.zoom + viewport.panY }
}

/** Zooms around a screen-space anchor so the world point under it stays fixed. */
export function zoomAt(viewport: DesignViewport, factor: number, anchor: DesignViewportPoint): DesignViewport {
  const zoom = clampZoom(viewport.zoom * factor)
  const world = screenToWorld(viewport, anchor)
  return { zoom, panX: anchor.x - world.x * zoom, panY: anchor.y - world.y * zoom }
}

export function panBy(viewport: DesignViewport, deltaX: number, deltaY: number): DesignViewport {
  return { ...viewport, panX: viewport.panX + deltaX, panY: viewport.panY + deltaY }
}
