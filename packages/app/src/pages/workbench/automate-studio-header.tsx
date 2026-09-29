/* SPDX-License-Identifier: MIT */

import { For, Show, type JSX } from "solid-js"
import { DropdownMenu } from "@unifia/ui/dropdown-menu"
import { useLanguage } from "@/context/language"

/**
 * Header of the flow studio (`.a60-head`, ADR-086): workflow title with its
 * dirty dot and version line, environment, save state, then undo, redo,
 * Versions, Import, Export and Publish. Phones keep the title, environment
 * and Publish, and fold the rest into "•••" like the reference.
 */
export function AutomateStudioHeader(props: {
  name: string | undefined
  versionLine: string
  dirty: boolean
  saveState: string
  files: readonly string[]
  selected: string | undefined
  onSelect: (path: string) => void
  onCreate: () => void
  onShowEnvironment: () => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  versions: readonly string[]
  onOpenVersion: (path: string) => void
  onSaveCanonical: () => void
  onImport: (file: File) => void
  onExport: () => void
  onPublish: () => void
  canPublish: boolean
  compact: boolean
}): JSX.Element {
  const language = useLanguage()
  const t = language.t
  let importInput: HTMLInputElement | undefined
  const fileName = (path: string) => path.split("/").at(-1) ?? path

  const versionItems = () => (
    <>
      <For each={props.versions} fallback={<DropdownMenu.Item disabled><DropdownMenu.ItemLabel>{t("automate.studio.versions.empty")}</DropdownMenu.ItemLabel></DropdownMenu.Item>}>
        {(path) => (
          <DropdownMenu.Item data-automate-studio-version={path} onSelect={() => props.onOpenVersion(path)}>
            <DropdownMenu.ItemLabel>{fileName(path)}</DropdownMenu.ItemLabel>
          </DropdownMenu.Item>
        )}
      </For>
      <DropdownMenu.Separator />
      <DropdownMenu.Item data-automate-studio-save-canonical onSelect={() => props.onSaveCanonical()}>
        <DropdownMenu.ItemLabel>{t("workbench.automate.runBar.action.save")}</DropdownMenu.ItemLabel>
      </DropdownMenu.Item>
    </>
  )

  return (
    <header data-automate-studio-head>
      <DropdownMenu gutter={4} placement="bottom-start">
        <DropdownMenu.Trigger data-automate-studio-title aria-label={t("automate.studio.workflows")}>
          <span data-automate-studio-dirty data-dirty={props.dirty ? "" : undefined} />
          <b>{props.name ?? t("automate.studio.noWorkflow")}</b>
          <Show when={!props.compact && props.name}>
            <span data-automate-studio-version-line>{props.versionLine}</span>
          </Show>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content data-automate-studio-workflow-menu>
            <For each={props.files}>
              {(path) => (
                <DropdownMenu.Item data-automate-definition={path} onSelect={() => props.onSelect(path)}>
                  <DropdownMenu.ItemLabel>{fileName(path)}</DropdownMenu.ItemLabel>
                </DropdownMenu.Item>
              )}
            </For>
            <Show when={props.files.length > 0}>
              <DropdownMenu.Separator />
            </Show>
            <DropdownMenu.Item data-automate-studio-new-workflow onSelect={() => props.onCreate()}>
              <DropdownMenu.ItemLabel>{t("automate.studio.newWorkflow")}</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
      <button type="button" data-automate-studio-env onClick={() => props.onShowEnvironment()}>
        <span>{t("automate.studio.environment")}</span>
        <i>⌄</i>
      </button>
      <Show when={!props.compact}>
        <span data-automate-studio-save-state>{props.saveState}</span>
      </Show>
      <span data-automate-studio-spacer />
      <input
        ref={importInput}
        type="file"
        accept="application/json,.json"
        hidden
        data-automate-studio-import-input
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ""
          if (file) props.onImport(file)
        }}
      />
      <Show
        when={!props.compact}
        fallback={
          <DropdownMenu gutter={4} placement="bottom-end">
            <DropdownMenu.Trigger data-automate-studio-more aria-label={t("automate.studio.more")}>
              •••
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content data-automate-studio-more-menu>
                <DropdownMenu.Item disabled={!props.canUndo} onSelect={() => props.onUndo()}>
                  <DropdownMenu.ItemLabel>{t("automate.studio.undo")}</DropdownMenu.ItemLabel>
                </DropdownMenu.Item>
                <DropdownMenu.Item disabled={!props.canRedo} onSelect={() => props.onRedo()}>
                  <DropdownMenu.ItemLabel>{t("automate.studio.redo")}</DropdownMenu.ItemLabel>
                </DropdownMenu.Item>
                <DropdownMenu.Separator />
                {versionItems()}
                <DropdownMenu.Separator />
                <DropdownMenu.Item onSelect={() => importInput?.click()}>
                  <DropdownMenu.ItemLabel>{t("automate.studio.import")}</DropdownMenu.ItemLabel>
                </DropdownMenu.Item>
                <DropdownMenu.Item onSelect={() => props.onExport()}>
                  <DropdownMenu.ItemLabel>{t("automate.studio.export")}</DropdownMenu.ItemLabel>
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu>
        }
      >
        <button
          type="button"
          data-automate-studio-undo
          disabled={!props.canUndo}
          title={t("automate.studio.undo")}
          aria-label={t("automate.studio.undo")}
          onClick={() => props.onUndo()}
        >
          ↶
        </button>
        <button
          type="button"
          data-automate-studio-redo
          disabled={!props.canRedo}
          title={t("automate.studio.redo")}
          aria-label={t("automate.studio.redo")}
          onClick={() => props.onRedo()}
        >
          ↷
        </button>
        <DropdownMenu gutter={4} placement="bottom-end">
          <DropdownMenu.Trigger data-automate-studio-versions>{t("automate.studio.versions")}</DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content data-automate-studio-versions-menu>{versionItems()}</DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu>
        <button type="button" data-automate-studio-import onClick={() => importInput?.click()}>
          {t("automate.studio.import")}
        </button>
        <button type="button" data-automate-studio-export disabled={!props.name} onClick={() => props.onExport()}>
          {t("automate.studio.export")}
        </button>
      </Show>
      <button type="button" data-automate-studio-publish disabled={!props.canPublish} onClick={() => props.onPublish()}>
        {t("automate.studio.publish")}
      </button>
    </header>
  )
}
