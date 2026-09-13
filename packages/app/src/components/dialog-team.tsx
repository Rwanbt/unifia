import { onMount } from "solid-js"
import { useLanguage } from "@/context/language"
import { useTeam } from "@/context/team"
import { teamLabels } from "@/i18n/team-labels"
import { TeamPanel } from "./team/team-panel"

/**
 * Team dialog content, mounted by <TeamDialogHost/> inside TeamProvider's
 * scope (#82). It cannot go through the shared <DialogOutlet/>: that
 * outlet renders at RouterRoot, above every directory-scoped provider,
 * so useTeam() would throw. The host assembles the Kobalte + Dialog
 * surface; this component owns the data refresh and the panel.
 */
export function TeamDialogContent() {
  const language = useLanguage()
  const team = useTeam()

  onMount(() => {
    void Promise.all([team.runs.refresh(), team.models.refresh(), team.health.refresh()])
  })

  return <TeamPanel labels={teamLabels(language.t)} />
}