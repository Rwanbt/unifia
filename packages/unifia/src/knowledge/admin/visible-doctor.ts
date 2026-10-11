/* SPDX-License-Identifier: MIT */
/**
 * The vault's doctor, run on the notes the owner may read.
 *
 * `doctor` checks identities, links and the index of the notes it is given. The CLI used to give it an empty
 * set, so it reported no finding whatever the vault held. This builds the set from the facade. Notes the
 * owner may not read are not in the set: they are not checked, and their locators never appear in a finding.
 */
import type { KnowledgeId, KnowledgeLocator } from "@unifia/contracts/knowledge"
import type { KnowledgeService } from "../facade/service.js"
import { doctor, type DoctorInput, type DoctorReport } from "./doctor.js"

export async function diagnoseVisibleVault(service: KnowledgeService, now: Date = new Date()): Promise<DoctorReport> {
  const visible = await service.listVisible()
  const byId = new Map<KnowledgeId, { locator: KnowledgeLocator; type: string; lifecycle: string }>()
  const knownLocators = new Set<KnowledgeLocator>()
  for (const note of visible) {
    byId.set(note.id, { locator: note.locator, type: note.type, lifecycle: note.lifecycle })
    knownLocators.add(note.locator)
  }
  const edges: { source: KnowledgeLocator; target: KnowledgeLocator }[] = []
  for (const note of visible) {
    for (const link of await service.outgoingLinks(note.id)) {
      // A resolved link points at the locator of the note it names. An unresolved one keeps the target as
      // written, which is not a known locator, so the doctor reports it as broken.
      const target = link.resolvedId === null ? undefined : byId.get(link.resolvedId)?.locator
      edges.push({ source: note.locator, target: target ?? (link.target as KnowledgeLocator) })
    }
  }
  return doctor({
    byId,
    knownLocators,
    edges,
    index: { rebuiltAt: now.toISOString(), candidatesCount: visible.length },
    indexedLocators: knownLocators,
  })
}
