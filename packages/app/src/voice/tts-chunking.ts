/* SPDX-License-Identifier: MIT */

/**
 * Chunking for streamed speech synthesis.
 *
 * The desktop hook owned this logic alone. It is pure, so it belongs to the
 * shared speech module where the other shells can reuse it and where it is
 * unit-tested instead of being exercised only through a running app.
 */

/** Hard upper bound per chunk (Pocket TTS ≈ 27 ms/char → 100 c ≈ 2.7 s). */
export const CHUNK_HARD_MAX = 100
/** Minimum position for a secondary cut inside a long sentence. */
const CHUNK_MIN_CUT = 50
/** Target size after merging short chunks, with headroom below the hard max. */
const CHUNK_MERGE_TARGET = 80

/**
 * Extract a tiny first chunk (~10-15 chars) for minimal time-to-first-audio.
 *
 * - text shorter than 15 chars: the whole text is the first chunk
 * - prefer a `,` `:` `;` break in positions 8..15
 * - else cut at the first space at position >= 8
 * - no break point (single long word): the whole text
 */
export function splitFirstTinyChunk(text: string): [string, string] {
  const trimmed = text.trim()
  if (trimmed.length < 15) return [trimmed, ""]

  const min = 8
  const max = 15

  for (let i = min; i <= max && i < trimmed.length; i++) {
    const char = trimmed[i]
    if (char === "," || char === ":" || char === ";") {
      return [trimmed.slice(0, i + 1).trim(), trimmed.slice(i + 1).trim()]
    }
  }

  for (let i = min; i < trimmed.length; i++) {
    if (trimmed[i] === " ") return [trimmed.slice(0, i).trim(), trimmed.slice(i + 1).trim()]
  }

  return [trimmed, ""]
}

/**
 * Split a sentence longer than the hard max at secondary punctuation or a word
 * boundary, balancing parts when the sentence is only slightly over the limit.
 */
export function splitLongSentence(sentence: string): string[] {
  if (sentence.length <= CHUNK_HARD_MAX) return [sentence.trim()].filter((part) => part.length > 0)

  const parts: string[] = []
  let start = 0

  while (start < sentence.length) {
    const remaining = sentence.length - start
    if (remaining <= CHUNK_HARD_MAX) {
      const tail = sentence.slice(start).trim()
      if (tail.length > 0) parts.push(tail)
      break
    }

    const minCut = start + CHUNK_MIN_CUT
    const maxCut = Math.min(start + CHUNK_HARD_MAX, sentence.length - 1)
    const targetCut = remaining < CHUNK_HARD_MAX * 2
      ? start + Math.floor(remaining / 2)
      : start + CHUNK_HARD_MAX

    let cut = -1
    for (let i = minCut; i <= maxCut; i++) {
      const char = sentence[i]
      if (char === "," || char === ":" || char === ";") {
        cut = i + 1
        break
      }
    }

    if (cut === -1) {
      let bestDistance = Infinity
      let bestPosition = -1
      for (let i = minCut; i <= maxCut; i++) {
        if (sentence[i] !== " ") continue
        const distance = Math.abs(i - targetCut)
        if (distance < bestDistance) {
          bestDistance = distance
          bestPosition = i
        }
      }
      if (bestPosition !== -1) cut = bestPosition
    }

    if (cut === -1) cut = maxCut

    const part = sentence.slice(start, cut).trim()
    if (part.length > 0) parts.push(part)
    start = cut
    while (start < sentence.length && sentence[start] === " ") start++
  }

  return parts
}

/** Merge consecutive short chunks while the combined length stays within `maxLen`. */
export function mergeShortChunks(chunks: string[], maxLen: number): string[] {
  if (chunks.length <= 1) return chunks

  const merged: string[] = []
  let current = chunks[0]

  for (let i = 1; i < chunks.length; i++) {
    const next = chunks[i]
    const combined = current + " " + next
    if (combined.length <= maxLen) current = combined
    else {
      merged.push(current)
      current = next
    }
  }
  merged.push(current)
  return merged
}

/**
 * Split text for streamed synthesis: a tiny first chunk for the shortest
 * time-to-first-audio, then sentence chunks, then merged micro-fragments.
 * No chunk ever exceeds `CHUNK_HARD_MAX`.
 */
export function splitIntoChunks(text: string): string[] {
  const [first, rest] = splitFirstTinyChunk(text)
  if (!first) return []
  if (!rest) return [first]

  const sentences = rest.split(/(?<=[.!?\n])\s+/).filter((sentence) => sentence.trim().length > 0)

  const body: string[] = []
  for (const sentence of sentences) {
    const trimmed = sentence.trim()
    if (trimmed.length === 0) continue
    if (trimmed.length <= CHUNK_HARD_MAX) body.push(trimmed)
    else body.push(...splitLongSentence(trimmed))
  }

  return [first, ...mergeShortChunks(body, CHUNK_MERGE_TARGET)]
}
