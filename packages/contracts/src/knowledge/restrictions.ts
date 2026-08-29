/* SPDX-License-Identifier: MIT */
/**
 * Portable restrictions and provenance.
 *
 * See ADR-KNOW-0006 (Egress policy) and plan gelé §34 (Provenance).
 *
 * `PortableRestrictions` may only RESTRICT. They travel with the
 * note (Class A) and can be tightened by a local action
 * (Class C) but never loosened.
 */

import { z } from "zod"

/**
 * Restriction level. `deny` is the default for unclassified content
 * egressing to a remote model.
 */
export const RestrictionLevelSchema = z.enum(["allow", "deny"])
export type RestrictionLevel = z.infer<typeof RestrictionLevelSchema>

/**
 * Portable restrictions carried in a note's frontmatter. They
 * can only restrict; missing fields default to `deny` for egress
 * (see ADR-KNOW-0006 §1).
 */
export interface PortableRestrictions {
  /** Egress to a remote (cloud) LLM. Default: deny. */
  remoteModel: RestrictionLevel
  /** Egress to a local LLM. Default: allow. */
  localModel: RestrictionLevel
  /**
   * Whether the content may be embedded into the FTS / vector
   * index. Default: allow. Some notes (e.g. credentials) must
   * NOT be embedded.
   */
  embeddable: RestrictionLevel
  /**
   * Whether the content may be exported by an exporter
   * (Langfuse, etc.). Default: deny for UNCLASSIFIED.
   */
  exportable: RestrictionLevel
}

export const PortableRestrictionsSchema = z
  .object({
    remoteModel: RestrictionLevelSchema,
    localModel: RestrictionLevelSchema,
    embeddable: RestrictionLevelSchema,
    exportable: RestrictionLevelSchema,
  })
  .strict()

/**
 * Minimal portable provenance. Carried in the note frontmatter.
 * Anything that is device- or session-specific belongs in Class C,
 * not here. See ADR-KNOW-0003 (Class B copy-on-write) for
 * portable aliases and external IDs.
 */
export interface PortableProvenance {
  /** When the note was first written (ISO-8601, UTC). */
  createdAt: string
  /** When the note was last updated (ISO-8601, UTC). */
  updatedAt: string
  /** Logical project ref, e.g. "unifia". Free-form string. */
  projectRef: string
  /** Source document path, if imported. */
  sourceDocument?: string
  /** Source commit SHA, if known. */
  sourceCommit?: string
}

export const PortableProvenanceSchema = z
  .object({
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    projectRef: z.string().min(1),
    sourceDocument: z.string().optional(),
    sourceCommit: z.string().regex(/^[0-9a-f]{7,64}$/i).optional(),
  })
  .strict()
