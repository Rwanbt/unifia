/* SPDX-License-Identifier: MIT */

export type BrowserViewportPoint = { x: number; y: number }
export type BrowserViewportBounds = { left: number; top: number; width: number; height: number }

export function browserViewportPoint(
  client: BrowserViewportPoint,
  bounds: BrowserViewportBounds,
  image: { width: number; height: number },
  viewport: { width: number; height: number },
): BrowserViewportPoint | undefined {
  if ([bounds.width, bounds.height, image.width, image.height, viewport.width, viewport.height].some((value) => value <= 0)) return

  const scale = Math.min(bounds.width / image.width, bounds.height / image.height)
  const renderedWidth = image.width * scale
  const renderedHeight = image.height * scale
  const offsetX = (bounds.width - renderedWidth) / 2
  const offsetY = (bounds.height - renderedHeight) / 2
  const localX = client.x - bounds.left - offsetX
  const localY = client.y - bounds.top - offsetY
  if (localX < 0 || localX >= renderedWidth || localY < 0 || localY >= renderedHeight) return

  return {
    x: localX * viewport.width / renderedWidth,
    y: localY * viewport.height / renderedHeight,
  }
}
