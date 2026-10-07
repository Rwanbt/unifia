/* SPDX-License-Identifier: MIT */

import fs from "node:fs/promises"
import { join } from "node:path"

/**
 * The canvas document is workspace-backed (f5fa054696): design-canvas-tab.tsx
 * composes an SDK file store over the localStorage repository, and the
 * localStorage copy is only read when the workspace file is absent - once, as
 * a legacy import - or when the workspace read fails
 * (persistence/workspace-repository.ts). The document id is the hardcoded
 * "canvas", so there is one file per workspace, and `directory` is
 * worker-scoped: without a reset, the file a previous spec left behind wins
 * over this spec's localStorage seed.
 */
export const CANVAS_DOCUMENT_STORAGE_KEY = "unifia-design-document:v1:canvas"

function canvasDocumentPath(directory: string) {
  return join(directory, ".unifia", "design", "canvas.design.json")
}

/** Removes the workspace canvas so the next load imports the localStorage seed. */
export async function resetWorkspaceCanvas(directory: string): Promise<void> {
  await fs.rm(canvasDocumentPath(directory), { force: true })
}

/**
 * Reads the document the product actually writes. Edits are saved to the
 * workspace; the localStorage copy is only refreshed when that write fails, so
 * reading it back can never observe a real edit.
 */
export async function readCanvasDocument<T>(directory: string): Promise<T | null> {
  const raw = await fs.readFile(canvasDocumentPath(directory), "utf8").catch(() => null)
  return raw === null ? null : (JSON.parse(raw) as T)
}
