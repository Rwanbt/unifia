/* SPDX-License-Identifier: MIT */
/**
 * External knowledge source.
 *
 * Per ADR-KNOW-0002 and plan gelé §17, an external space is
 * read-only by default. Capabilities (`read`, `watch`, `write`,
 * `metadata-write`) are explicit and must be granted by the
 * user.
 *
 * The runtime implementation is owned by `NativeKnowledgePort`
 * (Rust). The TS file only defines the contract.
 */

import type {
  KnowledgeSpace,
  KnowledgeSpaceKind,
  KnowledgeLocator,
  KnowledgeId,
  ExternalSpaceCapability,
} from "@unifia/contracts/knowledge"
import type {
  KnowledgeSource,
  ListOptions,
  ListedNote,
  SourceEvent,
} from "./source.js"
import type { ParsedDocument } from "../parser/parser.js"

export interface ExternalSourceConfig {
  /** Stable identifier of the mount. */
  mountId: string
  /** Human-readable label. */
  label: string
  /** Granted capabilities. Empty = read-only default. */
  capabilities?: ExternalSpaceCapability[]
}

export class ExternalSource implements KnowledgeSource {
  readonly space: KnowledgeSpace
  private readonly impl: KnowledgeSource

  constructor(config: ExternalSourceConfig, impl: KnowledgeSource) {
    const caps = config.capabilities ?? ["read"]
    this.space = {
      kind: "external" satisfies KnowledgeSpaceKind,
      id: config.mountId,
      label: config.label,
      capabilities: caps,
    }
    this.impl = impl
  }

  get canRead(): boolean {
    return (this.space.capabilities ?? []).includes("read")
  }
  get canWatch(): boolean {
    return (this.space.capabilities ?? []).includes("watch")
  }
  get canWrite(): boolean {
    return (this.space.capabilities ?? []).includes("write")
  }
  get canMetadataWrite(): boolean {
    return (this.space.capabilities ?? []).includes("metadata-write")
  }

  list(options: ListOptions): Promise<ListedNote[]> {
    return this.impl.list(options)
  }
  read(locator?: KnowledgeLocator, id?: KnowledgeId): Promise<ParsedDocument | null> {
    return this.impl.read(locator, id)
  }
  watch(onChange: (event: SourceEvent) => void): () => void {
    return this.impl.watch(onChange)
  }
}
