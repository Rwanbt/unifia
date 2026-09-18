// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
//
// pixelmatch 5.3.0 (the version pinned in package.json) ships no type
// declarations and has no real @types/pixelmatch entry (DefinitelyTyped's
// package is a stub pointing at pixelmatch's own types, which do not exist
// at this version). This covers the one signature pixel-diff.ts calls.

declare module "pixelmatch" {
  export interface PixelmatchOptions {
    threshold?: number
    includeAA?: boolean
    alpha?: number
    aaColor?: [number, number, number]
    diffColor?: [number, number, number]
    diffColorAlt?: [number, number, number]
    diffMask?: boolean
  }

  export default function pixelmatch(
    img1: Uint8Array | Uint8ClampedArray,
    img2: Uint8Array | Uint8ClampedArray,
    output: Uint8Array | Uint8ClampedArray | null,
    width: number,
    height: number,
    options?: PixelmatchOptions,
  ): number
}
