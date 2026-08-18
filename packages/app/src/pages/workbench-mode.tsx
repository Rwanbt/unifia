/* SPDX-License-Identifier: MIT */

import { Show, type JSX } from "solid-js"
import { useMode } from "@/context/mode"
import { useLanguage } from "@/context/language"
import { WorkSurface } from "@/pages/workbench/work-surface"
import { DesignSurface } from "@/pages/workbench/design-surface"
import { AutomateSurface } from "@/pages/workbench/automate-surface"

export default function WorkbenchMode(): JSX.Element {
  const mode = useMode()
  const language = useLanguage()
  const t = language.t
  return (
    <main class="size-full min-h-0 bg-background-base" data-workbench-mode={mode.active()}>
      <Show when={mode.routeKind() === "invalid"}>
        <section class="size-full p-6" data-workbench-error="invalid-route">
          <h1 class="text-18-medium">{t("workbench.errors.invalidMode")}</h1>
          <p class="mt-2 text-14-regular text-text-weak">{t("workbench.errors.invalidModeDescription")}</p>
        </section>
      </Show>
      <Show when={mode.active() === "work"}>
        <WorkSurface />
      </Show>
      <Show when={mode.active() === "design"}>
        <DesignSurface />
      </Show>
      <Show when={mode.active() === "automate"}>
        <AutomateSurface />
      </Show>
    </main>
  )
}
