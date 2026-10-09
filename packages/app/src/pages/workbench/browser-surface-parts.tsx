/* SPDX-License-Identifier: MIT */

import { For, Show, type JSX } from "solid-js"
import { MAX_BROWSER_UPLOAD_BYTES, type BrowserActivityEvent } from "@unifia/contracts"
import { useLanguage } from "@/context/language"
import { browserViewportPoint } from "@/pages/workbench/browser-viewport-coordinates"
import type { BrowserSessionController } from "@/pages/workbench/browser-session-controller"

const buttonClass = "rounded border border-border-base px-2 py-1 text-12-regular disabled:opacity-50"

const VIEWPORT_PRESETS = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "mobile", width: 390, height: 844 },
] as const

const ACTIVITY_KEYS: Partial<Record<BrowserActivityEvent["kind"], string>> = {
  "action.approval_required": "browser.activity.approvalRequired",
  "action.approval_denied": "browser.activity.approvalDenied",
  "action.approval_unavailable": "browser.activity.approvalUnavailable",
  "action.approval_cancelled": "browser.activity.approvalCancelled",
  "action.started": "browser.activity.actionStarted",
  "action.completed": "browser.activity.actionCompleted",
  "action.failed": "browser.activity.actionFailed",
  "navigation.blocked": "browser.activity.navigationBlocked",
  "network.blocked": "browser.activity.networkBlocked",
  "page.observed": "browser.activity.pageObserved",
  "user.upload": "browser.activity.userUpload",
}

type Translate = (key: string, params?: Record<string, string | number>) => string

export function browserActivityLabel(event: BrowserActivityEvent, t: Translate): string {
  if (event.kind === "controller.changed") {
    const controller = event.controller ? t(`inspector.browser.controller.${event.controller}`) : ""
    return t("browser.activity.controllerChanged", { controller })
  }
  const key = ACTIVITY_KEYS[event.kind]
  return key ? t(key) : event.kind.replaceAll(".", " ")
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = ""
  // String.fromCharCode spreads its arguments; chunking keeps it under the engine's argument limit.
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  return btoa(binary)
}

export function BrowserTabStrip(props: { browser: BrowserSessionController }): JSX.Element {
  const language = useLanguage()
  const b = props.browser
  let uploadInput: HTMLInputElement | undefined
  const chooseUpload = async (file: File | undefined) => {
    try {
      if (!file) return
      if (file.size === 0 || file.size > MAX_BROWSER_UPLOAD_BYTES) return b.setError(language.t("workbench.design.browser.uploadSizeError"))
      b.upload({ name: file.name, mediaType: file.type || "application/octet-stream", base64: encodeBase64(new Uint8Array(await file.arrayBuffer())) })
    } finally {
      if (uploadInput) uploadInput.value = ""
    }
  }
  const editable = () => Boolean(b.activeTab()) && b.userControls()
  return (
    <div class="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border-base px-2 py-1" data-browser-tabs>
      <For each={b.state.session?.tabs}>
        {(tab) => (
          <div class="flex shrink-0 items-center gap-1 rounded border border-border-base px-2 py-1" data-browser-tab={tab.id}>
            <button type="button" class="max-w-40 truncate text-12-regular" aria-current={tab.id === b.state.session?.activeTabId ? "page" : undefined} aria-busy={tab.loading} onClick={() => b.chooseTab(tab.id)}>
              {tab.title || tab.url || language.t("browser.surface.newTab")}
              {tab.loading ? ` · ${language.t("browser.surface.tabLoading")}` : ""}
            </button>
            <button type="button" class="text-12-regular" aria-label={language.t("browser.surface.closeTab", { title: tab.title || language.t("browser.surface.newTab") })} onClick={() => b.closeTab(tab.id)}>
              ×
            </button>
          </div>
        )}
      </For>
      <button type="button" class={buttonClass} aria-label={language.t("browser.surface.newTab")} onClick={b.openTab}>
        +
      </button>
      <div class="flex shrink-0 items-center gap-1" role="group" aria-label={language.t("browser.surface.viewportPresets")}>
        <For each={VIEWPORT_PRESETS}>
          {(preset) => (
            <button
              type="button"
              class={buttonClass}
              aria-pressed={b.state.session?.viewport.width === preset.width && b.state.session?.viewport.height === preset.height}
              title={language.t("browser.surface.viewportPresetTitle", { width: preset.width, height: preset.height })}
              disabled={!editable()}
              onClick={() => b.resizeViewport({ width: preset.width, height: preset.height })}
              data-browser-viewport-preset={preset.name}
            >
              {language.t(`browser.surface.preset.${preset.name}`)}
            </button>
          )}
        </For>
      </div>
      <input ref={uploadInput} type="file" class="hidden" aria-label={language.t("workbench.design.browser.uploadInput")} onChange={(event) => void chooseUpload(event.currentTarget.files?.[0])} />
      <button type="button" class={buttonClass} disabled={!editable()} title={language.t("workbench.design.browser.uploadHint")} onClick={() => uploadInput?.click()}>
        {language.t("workbench.design.browser.upload")}
      </button>
      <Show when={b.state.uploadApproval}>
        {(approval) => (
          <button type="button" class={buttonClass} onClick={b.approveUpload} data-browser-upload-approval={approval().approvalId}>
            {language.t("workbench.design.browser.uploadApproval")}
          </button>
        )}
      </Show>
      <div class="ml-auto flex shrink-0 items-center gap-1">
        <Show when={b.userControls()} fallback={<button type="button" class={buttonClass} onClick={() => b.setController("user")}>{language.t("browser.surface.takeControl")}</button>}>
          <button type="button" class={buttonClass} onClick={() => b.setController("ai")}>
            {language.t("browser.surface.returnToAi")}
          </button>
        </Show>
        <span class="text-11-regular text-text-weak" data-browser-controller={b.state.session?.controller ?? "paused"}>
          {language.t(`inspector.browser.controller.${b.state.session?.controller ?? "paused"}`)}
        </span>
      </div>
    </div>
  )
}

export function BrowserAddressBar(props: { browser: BrowserSessionController }): JSX.Element {
  const language = useLanguage()
  const b = props.browser
  const submit = (event: SubmitEvent) => {
    event.preventDefault()
    b.navigate(b.state.address, language.t("workbench.design.browser.addressRequired"))
  }
  return (
    <form class="flex shrink-0 items-center gap-2 border-b border-border-base p-2" onSubmit={submit}>
      <button type="button" class={buttonClass} disabled={!b.activeTab()?.canGoBack} aria-label={language.t("workbench.design.browser.back")} onClick={() => b.history("back")}>
        ←
      </button>
      <button type="button" class={buttonClass} disabled={!b.activeTab()?.canGoForward} aria-label={language.t("workbench.design.browser.forward")} onClick={() => b.history("forward")}>
        →
      </button>
      <button type="button" class={buttonClass} disabled={!b.activeTab()} aria-label={language.t("workbench.design.browser.reload")} onClick={() => b.history("reload")}>
        ⟳
      </button>
      <input class="min-w-0 flex-1 rounded border border-border-base bg-background-base px-2 py-1 text-12-regular" aria-label="URL" value={b.state.address} onInput={(event) => b.setAddress(event.currentTarget.value)} placeholder="https://example.com" />
      <button type="submit" class={buttonClass} disabled={!b.activeTab()}>
        {language.t("workbench.design.browser.go")}
      </button>
    </form>
  )
}

export function BrowserViewport(props: { browser: BrowserSessionController }): JSX.Element {
  const language = useLanguage()
  const b = props.browser
  let viewport: HTMLDivElement | undefined
  let frame: HTMLImageElement | undefined
  const click = (event: MouseEvent) => {
    if (!viewport || !frame || !b.activeTab() || !b.state.frame) return
    viewport.focus()
    const point = browserViewportPoint(
      { x: event.clientX, y: event.clientY },
      frame.getBoundingClientRect(),
      { width: frame.naturalWidth, height: frame.naturalHeight },
      b.state.session?.viewport ?? { width: 1280, height: 800 },
    )
    if (!point) return
    const button = event.button === 1 ? "middle" : event.button === 2 ? "right" : "left"
    void b.sendInput({ kind: "pointer", ...point, button })
  }
  const keyDown = (event: KeyboardEvent) => {
    // Shortcuts stay with the app; only plain keys reach the page.
    if (event.ctrlKey || event.metaKey || event.altKey) return
    event.preventDefault()
    void b.sendInput(event.key.length === 1 ? { kind: "text", text: event.key } : { kind: "key", key: event.key })
  }
  const wheel = (event: WheelEvent) => {
    event.preventDefault()
    void b.sendInput({ kind: "scroll", deltaX: event.deltaX, deltaY: event.deltaY })
  }
  const placeholder = (text: string) => <div class="flex size-full items-center justify-center text-12-regular text-text-weak">{text}</div>
  return (
    <div class="min-h-0 flex-1 bg-background-weak" data-workbench-surface="browser" data-parity="browser.surface">
      <Show when={!b.state.loading} fallback={placeholder(language.t("browser.surface.starting"))}>
        <div ref={viewport} class="size-full overflow-hidden" tabindex="0" role="application" aria-label={language.t("browser.surface.viewport")} aria-busy={b.activeTab()?.loading ?? false} data-browser-viewport onClick={click} onKeyDown={keyDown} onWheel={wheel}>
          <Show when={b.state.frame} fallback={placeholder(language.t("browser.surface.empty"))}>
            {(src) => <img ref={frame} class="size-full select-none object-contain" src={src()} alt={language.t("browser.surface.frameAlt")} draggable={false} />}
          </Show>
        </div>
      </Show>
    </div>
  )
}

export function BrowserActivityStrip(props: { browser: BrowserSessionController }): JSX.Element {
  const language = useLanguage()
  return (
    <div class="flex max-h-28 shrink-0 items-center gap-2 overflow-x-auto border-t border-border-base px-2 py-1" data-browser-activity aria-label={language.t("browser.surface.activity")}>
      <strong class="shrink-0 text-11-medium">{language.t("browser.surface.activity")}</strong>
      <For each={props.browser.state.activity}>
        {(event) => (
          <span class="shrink-0 text-11-regular text-text-weak" data-browser-activity-event={event.sequence} title={new Date(event.occurredAt).toLocaleString()}>
            <time dateTime={new Date(event.occurredAt).toISOString()}>{new Date(event.occurredAt).toLocaleTimeString()}</time> {browserActivityLabel(event, language.t)}
            {event.detail ? ` · ${event.detail}` : ""}
          </span>
        )}
      </For>
    </div>
  )
}

export function BrowserDownloadStrip(props: { browser: BrowserSessionController }): JSX.Element {
  const language = useLanguage()
  const b = props.browser
  return (
    <Show when={b.state.downloads.length > 0}>
      <div class="flex max-h-24 shrink-0 items-center gap-2 overflow-x-auto border-t border-border-base px-2 py-1" data-browser-downloads aria-label={language.t("browser.surface.downloads")}>
        <strong class="shrink-0 text-11-medium">{language.t("browser.surface.quarantine")}</strong>
        <For each={b.state.downloads}>
          {(download) => (
            <div class="flex shrink-0 items-center gap-2 text-11-regular" data-browser-download={download.id}>
              <span>
                {download.filename} · {download.size} B · {download.inspection.mediaType} · {download.inspection.extensionStatus} · {download.inspection.malwareScan} · {download.status}
              </span>
              <Show when={download.status === "quarantined"}>
                <button
                  type="button"
                  class={buttonClass}
                  disabled={download.inspection.malwareScan !== "clean"}
                  title={download.inspection.malwareScan !== "clean" ? language.t("browser.surface.cleanScanRequired") : undefined}
                  onClick={() => b.requestDownloadRelease(download.id)}
                >
                  {language.t("browser.surface.requestRelease")}
                </button>
              </Show>
              <Show when={download.releasedFilename}>
                <span>{download.releasedFilename}</span>
              </Show>
            </div>
          )}
        </For>
        <Show when={b.state.releaseApproval}>
          {(approval) => (
            <button type="button" class={buttonClass} onClick={b.approveDownloadRelease} data-browser-download-approval={approval().approvalId}>
              {language.t("browser.surface.approveRelease")}
            </button>
          )}
        </Show>
      </div>
    </Show>
  )
}
