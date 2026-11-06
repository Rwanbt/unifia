/* SPDX-License-Identifier: MIT */

// =============================================================================
// pages/workbench/work-runs-panel.tsx — A5-02
//
// Replaces the v110 mockup's "Agents" panel: no per-agent identity is ever
// persisted or returned by the Team API (confirmed by a dedicated backend
// investigation during A5-01's planning — see the plan file), so this shows
// the real thing the backend has, a list of runs, instead of inventing agent
// names. Read-only: lifecycle controls (pause/resume/cancel) stay owned by
// TeamPanel so this surface doesn't grow a second copy of them — "Open Team"
// reaches the real thing for anyone who needs more than a glance.
//
// "Open Team" renders its own local Kobalte dialog root rather than routing
// through the app's shared <DialogOutlet/> (mounted at RouterRoot, app.tsx —
// outside every directory-scoped provider). Reproduced directly: opening the
// Team dialog through that shared outlet throws "Team context must be used
// within a context provider", because DialogTeam calls useTeam() and
// TeamProvider only wraps directory-scoped routes (directory-layout.tsx),
// below RouterRoot — the exact same call path the pre-existing command-palette
// `openTeam` command (layout.tsx) already uses, so this is not something A5-02
// introduced. Filed as #82 (the real fix touches DialogOutlet's placement or
// TeamPanel's context dependency, both wider than this PR's scope); this panel
// instead assembles the same public Kobalte + Dialog + TeamPanel pieces
// DialogOutlet itself uses, but locally, inside this component's own render
// tree — which already sits inside TeamProvider.
//
// A5-06: the start-run dialog is owned by WorkSurface so the cockpit header
// and this panel share one instance; this component only asks it to open.
// =============================================================================

import { createSignal, type JSX } from "solid-js"
import { Dialog as Kobalte } from "@kobalte/core/dialog"
import { Dialog } from "@unifia/ui/dialog"
import { CollectionView } from "@/components/team/collection-view"
import { TeamPanel } from "@/components/team/team-panel"
import { useLanguage } from "@/context/language"
import { useTeam } from "@/context/team"
import { teamLabels } from "@/i18n/team-labels"
import { closeModalOnBack } from "@/utils/modal-back"

export function WorkRunsPanel(props: { onStartRun: () => void }): JSX.Element {
  const language = useLanguage()
  const t = language.t
  const team = useTeam()
  const [open, setOpen] = createSignal(false)
  closeModalOnBack(open, () => setOpen(false))

  return (
    <div class="rounded-lg border border-border-base bg-background-stronger p-4" data-v110="work-runs-panel">
      <div class="flex items-center justify-between gap-2">
        <h2 class="text-14-medium">{t("workbench.work.runsTitle")}</h2>
        <div class="flex items-center gap-3">
          <button
            type="button"
            class="text-12-medium text-text-weak hover:underline"
            data-v110="work-start-run"
            onClick={() => props.onStartRun()}
          >
            {t("workbench.work.startRun.button")}
          </button>
          <button
            type="button"
            class="text-12-medium text-text-weak hover:underline"
            data-v110="work-open-team"
            onClick={() => setOpen(true)}
          >
            {t("workbench.work.openTeam")}
          </button>
        </div>
      </div>
      <div class="mt-3">
        <CollectionView
          page={team.runs.page()}
          reachability={team.runs.reachability()}
          labels={{
            empty: t("team.runs.empty"),
            unreachable: t("team.runs.unreachable"),
            stale: t("team.runs.stale"),
            more: t("team.runs.more"),
          }}
          onMore={() => void team.runs.more()}
          onRetry={() => void team.runs.refresh()}
        >
          {(run) => (
            <div class="flex items-center justify-between gap-2 text-11-regular">
              <span class="text-text-base">{run.runId}</span>
              <span class="text-text-weaker">{t(`team.runStatus.${run.status}`)}</span>
            </div>
          )}
        </CollectionView>
      </div>
      <Kobalte modal open={open()} onOpenChange={setOpen}>
        <Kobalte.Portal>
          <Kobalte.Overlay data-component="dialog-overlay" onClick={() => setOpen(false)} />
          <Dialog
            size="x-large"
            fit
            transition
            title={t("workbench.work.title")}
            class="max-h-[calc(100vh-40px)]"
          >
            <TeamPanel labels={teamLabels(t)} />
          </Dialog>
        </Kobalte.Portal>
      </Kobalte>
    </div>
  )
}
