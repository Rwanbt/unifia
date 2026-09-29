/* SPDX-License-Identifier: MIT */

import { Suspense, createSignal, lazy, onCleanup, onMount, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"

const Body = lazy(() => import("./status-popover-body").then((x) => ({ default: x.StatusPopoverBody })))

export const STATUS_SHEET_COMMAND = "status.sheet"

/**
 * The compute popover as the phone's bottom sheet (V5 prototype: "Plus" >
 * Compute opens #runtimePopoverV32 docked above the bottom bar, with a
 * grabber). Same body as the desktop popover, so both show the same five
 * tabs. It lives at directory scope because the body reads the directory's
 * sync and SDK; the bottom bar, above that scope, opens it through
 * STATUS_SHEET_COMMAND.
 */
export function StatusSheet() {
  const command = useCommand()
  const language = useLanguage()
  const [shown, setShown] = createSignal(false)
  let sheet: HTMLDivElement | undefined

  command.register("status-sheet", () => [
    {
      id: STATUS_SHEET_COMMAND,
      title: language.t("mobile.sheet.compute"),
      category: language.t("command.category.view"),
      onSelect: () => setShown((value) => !value),
    },
  ])

  onMount(() => {
    const closeOutside = (event: PointerEvent) => {
      if (!shown() || sheet?.contains(event.target as Node)) return
      // The bar's own "Plus" strip reopens it; everything else closes it.
      setShown(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShown(false)
    }
    document.addEventListener("pointerdown", closeOutside, true)
    document.addEventListener("keydown", closeOnEscape)
    onCleanup(() => {
      document.removeEventListener("pointerdown", closeOutside, true)
      document.removeEventListener("keydown", closeOnEscape)
    })
  })

  return (
    <Show when={shown()}>
      <Portal>
        <div ref={sheet} data-v110="status-sheet" role="dialog" aria-label={language.t("mobile.sheet.compute")}>
          <span data-slot="status-sheet-grabber" aria-hidden="true" />
          <Suspense>
            <Body shown={shown} />
          </Suspense>
        </div>
      </Portal>
    </Show>
  )
}
