/* SPDX-License-Identifier: MIT */
/**
 * Frontmatter parsing.
 *
 * `gray-matter` (already a dependency of `packages/unifia`) handles
 * YAML extraction. We only validate the schema (per
 * ADR-KNOW-0002) and re-serialise on demand.
 *
 * We never auto-correct: a malformed frontmatter is a hard
 * `KnowledgeFailure.sourceInconsistent` so the doctor can act.
 */

import matter from "gray-matter"
import { z } from "zod"
import {
  KnowledgeIdSchema,
  MemoryTypeSchema,
  KnowledgeLifecycleStateSchema,
  type NoteFrontmatter,
  NoteFrontmatterSchema,
} from "@unifia/contracts/knowledge"
import { KnowledgeFailure } from "../domain/errors.js"

/** A parsed Markdown file: frontmatter + body. */
export interface ParsedNote {
  frontmatter: NoteFrontmatter
  body: string
  raw: string
}

const StrictFrontmatterSchema = NoteFrontmatterSchema.extend({}).strict()

function normalizeUnknown(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeUnknown)
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = normalizeUnknown(v)
    return out
  }
  return value
}

function coerceFrontmatterShape(value: unknown): NoteFrontmatter {
  const obj = normalizeUnknown(value) as Record<string, unknown>
  if (typeof obj.unifia_id !== "string") {
    throw KnowledgeFailure.sourceInconsistent("unifia_id missing or not a string")
  }
  if (!KnowledgeIdSchema.safeParse(obj.unifia_id).success) {
    throw KnowledgeFailure.sourceInconsistent("unifia_id is not a canonical UUIDv7")
  }
  if (typeof obj.unifia_created_at !== "string" || typeof obj.unifia_updated_at !== "string") {
    throw KnowledgeFailure.sourceInconsistent("timestamps missing or not strings")
  }
  if (typeof obj.unifia_project_ref !== "string" || obj.unifia_project_ref.length === 0) {
    throw KnowledgeFailure.sourceInconsistent("unifia_project_ref missing")
  }
  const typeResult = MemoryTypeSchema.safeParse(obj.unifia_type)
  if (!typeResult.success) {
    throw KnowledgeFailure.sourceInconsistent(`unifia_type invalid: ${String(obj.unifia_type)}`)
  }
  const lifecycleResult = KnowledgeLifecycleStateSchema.safeParse(obj.unifia_lifecycle)
  if (!lifecycleResult.success) {
    throw KnowledgeFailure.sourceInconsistent(
      `unifia_lifecycle invalid: ${String(obj.unifia_lifecycle)}`,
    )
  }
  if (!Array.isArray(obj.unifia_supersedes) || !Array.isArray(obj.unifia_tags)) {
    throw KnowledgeFailure.sourceInconsistent("unifia_supersedes or unifia_tags is not an array")
  }

  const candidate: NoteFrontmatter = {
    unifia_schema: 1,
    unifia_id: obj.unifia_id,
    unifia_type: typeResult.data,
    unifia_lifecycle: lifecycleResult.data,
    unifia_created_at: obj.unifia_created_at,
    unifia_updated_at: obj.unifia_updated_at,
    unifia_project_ref: obj.unifia_project_ref,
    unifia_supersedes: obj.unifia_supersedes as string[],
    unifia_tags: obj.unifia_tags as string[],
  }

  const r = StrictFrontmatterSchema.safeParse(candidate)
  if (!r.success) {
    throw KnowledgeFailure.sourceInconsistent(
      "frontmatter failed strict validation",
      { issues: r.error.issues.length },
    )
  }
  return r.data as NoteFrontmatter
}

export function parseFrontmatter(raw: string): ParsedNote {
  let parsed: matter.GrayMatterFile<string>
  try {
    parsed = matter(raw)
  } catch (err) {
    throw KnowledgeFailure.sourceInconsistent(
      "YAML frontmatter parse failed",
      { reason: (err as Error).message.slice(0, 64) },
    )
  }
  if (parsed.data === null || typeof parsed.data !== "object" || Array.isArray(parsed.data)) {
    if (Object.keys(parsed.data ?? {}).length === 0) {
      throw KnowledgeFailure.sourceInconsistent("frontmatter is empty")
    }
    throw KnowledgeFailure.sourceInconsistent("frontmatter is not an object")
  }
  const frontmatter = coerceFrontmatterShape(parsed.data)
  return { frontmatter, body: parsed.content, raw }
}

export function serialiseNote(note: ParsedNote): string {
  const fm = {
    unifia_schema: 1 as const,
    unifia_id: note.frontmatter.unifia_id,
    unifia_type: note.frontmatter.unifia_type,
    unifia_lifecycle: note.frontmatter.unifia_lifecycle,
    unifia_created_at: note.frontmatter.unifia_created_at,
    unifia_updated_at: note.frontmatter.unifia_updated_at,
    unifia_project_ref: note.frontmatter.unifia_project_ref,
    unifia_supersedes: note.frontmatter.unifia_supersedes,
    unifia_tags: note.frontmatter.unifia_tags,
  }
  const yaml = matter.stringify(note.body, fm)
  return yaml.endsWith("\n") ? yaml : yaml + "\n"
}
