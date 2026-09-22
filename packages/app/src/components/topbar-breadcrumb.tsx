/* SPDX-License-Identifier: MIT */

import { createMemo, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { useLayout } from "@/context/layout"
import { useMode } from "@/context/mode"
import { useLanguage } from "@/context/language"
import { useTitlebarSlots } from "@/context/titlebar-slots"
import { getFilename } from "@unifia/util/path"
import { displayName } from "@/pages/layout/helpers"

// Ports .crumbs (Unifia-UI-UX-v110-PORT-READY-R1.html:15232,
// "<strong>Prism EQ</strong><span>/</span><span id=crumb>Code</span>").
// The maquette's .app.show-home rule (lines 4013-4027) hides .crumbs only on
// home. Settings is a workspace destination, so it must own the second crumb
// instead of inheriting the mode underneath it.
export function TopbarBreadcrumb() {
  const layout = useLayout()
  const mode = useMode()
  const language = useLanguage()
  const slots = useTitlebarSlots()

  const project = createMemo(() => {
    const directory = mode.directory()
    if (!directory) return undefined
    return layout.projects.list().find((p) => p.worktree === directory || p.sandboxes?.includes(directory))
  })

  const projectLabel = createMemo(() => {
    const directory = mode.directory()
    if (!directory) return undefined
    const current = project()
    return current ? displayName(current) : getFilename(directory)
  })

  const modeLabel = createMemo(() =>
    mode.destination() === "settings"
      ? language.t("sidebar.settings")
      : mode.destination() === "user"
        ? language.t("sidebar.account")
        : mode.destination() === "browser"
          ? language.t("sidebar.rail.browser")
          : mode.destination() === "memory"
            ? language.t("sidebar.rail.memory")
        : language.t(`workbench.modes.name.${mode.active()}`),
  )

  return (
    <Show when={mode.routeKind() !== "home" && projectLabel()}>
      {(name) => (
        <Show when={slots.left()}>
          {(mount) => (
            <Portal mount={mount()}>
              <div
                data-v110="crumbs"
                data-component="v110-crumbs"
                class="hidden shell:flex items-center gap-1.5 min-w-0 text-12-regular text-text-weak"
              >
                <span class="text-text-strong font-medium truncate">{name()}</span>
                <span aria-hidden="true">/</span>
                <span class="truncate">{modeLabel()}</span>
              </div>
            </Portal>
          )}
        </Show>
      )}
    </Show>
  )
}
