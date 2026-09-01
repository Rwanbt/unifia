/* SPDX-License-Identifier: MIT */
/**
 * Worker identity — Plan V2.3.1 §104, ADR-008.
 *
 * A WorkerId is the durable identity a worker process presents when it
 * joins a control plane. The proof is a signature made with the key
 * that ADR-010 binds to this worker at provisioning time; a control
 * plane that does not hold the matching public key refuses the join.
 *
 * The `version` field is the schema version of the WorkerId payload
 * itself, not of the worker process. Future fields are added by
 * bumping the version, not by overloading existing ones.
 *
 * `platform` is opaque — it carries whatever the OS / arch string the
 * provisioning step captured (e.g. "linux-x64", "darwin-arm64",
 * "win32-x64"). Matching against it is the schedulability check, not
 * here.
 */
import { z } from "zod"

export const WorkerIdSchema = z.object({
  /** Stable worker identifier (UUID / ULID / opaque handle). */
  workerId: z.string(),
  /** Signature of the remaining fields, produced by the ADR-010 key. */
  identityProof: z.string(),
  /** Schema version of this WorkerId payload. */
  version: z.string(),
  /** OS + arch string captured at provisioning time. */
  platform: z.string(),
  /** Capability tokens the worker has been issued (e.g. ["network.outbound"]). */
  capabilities: z.array(z.string()).readonly(),
  /** Execution profile ids the worker claims to satisfy (e.g. ["docker", "wasm"]). */
  executionProfiles: z.array(z.string()).readonly(),
  /** Coarse resource bucket (e.g. "small", "medium", "large", "gpu"). */
  resourceClass: z.string(),
})

export type WorkerId = z.infer<typeof WorkerIdSchema>
