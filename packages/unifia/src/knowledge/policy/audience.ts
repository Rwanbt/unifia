/* SPDX-License-Identifier: MIT */
/**
 * The restriction that applies to one note for one destination.
 *
 * Two audiences read a vault, and they are governed differently:
 *
 * - A model receives a note only if the note's restriction for that model
 *   allows it: `local_model` for a model on this machine, `remote_model` for
 *   one that leaves it.
 * - The owner, reading their own vault in the application, is not a model.
 *   Their view on this machine does not process the note with a model, so the
 *   model restrictions do not apply to it. The vault policy, the grants and
 *   the audit still do: they are checked outside this function, by the egress
 *   guard, on the same plan.
 *
 * An owner view that would leave the machine is refused by construction. It
 * is never a way to read a note for a remote destination.
 */
import type { ProviderDestinationPlan, RestrictionLevel } from "@unifia/contracts/knowledge"

export interface NoteModelRestrictions {
  localModel: RestrictionLevel
  remoteModel: RestrictionLevel
}

export function restrictionFor(
  restrictions: NoteModelRestrictions,
  plan: ProviderDestinationPlan,
): RestrictionLevel {
  if (plan.audience === "owner") {
    return plan.destinationKind === "local" ? "allow" : "deny"
  }
  // A plan that does not declare itself local is treated as remote.
  return plan.destinationKind === "local" ? restrictions.localModel : restrictions.remoteModel
}
