// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
//
// V0 pilot visual port of docs/ui-reference/v110/COMPONENT-MAP.md §1 (home).
// Matches the canonical v110-port-ready-r1 maquette (SHA-256 6c01e84c…b1ca69818b):
//   - state-line pill with server status
//   - title + subtitle
//   - composer card (input + meta pills + actions)
//   - recent-row with .home-quick-chip per recent project
//   - modes-row with six .home-mode-pill (code, work, design, automate, browser, memory)
//   - hint
//
// Browser and Memory are destinations, not SHELL_MODES (ADR-1041 / COMPONENT-MAP §0);
// the home pill selects the closest shell-mode route and the surfaces live there.

import { For, Match, Show, Switch, createMemo, createSignal } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { Button } from "@unifia/ui/button"
import { Icon } from "@unifia/ui/icon"
import { useDialog } from "@unifia/ui/context/dialog"
import { DialogSelectServer } from "@/components/dialog-select-server"
import { DialogSelectDirectory } from "@/components/dialog-select-directory"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useMode } from "@/context/mode"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { DateTime } from "luxon"

const MODE_PILLS = ["code", "work", "design", "automate", "browser", "memory"] as const
type ModePill = (typeof MODE_PILLS)[number]

const PILL_LABELS: Record<ModePill, string> = {
  code: "Code",
  work: "Work",
  design: "Design",
  automate: "Automate",
  browser: "Browser",
  memory: "Memory",
}

const PILL_TARGET: Record<ModePill, "code" | "work" | "design" | "automate"> = {
  code: "code",
  work: "work",
  design: "design",
  automate: "automate",
  browser: "design",
  memory: "code",
}

export default function Home() {
  const sync = useGlobalSync()
  const layout = useLayout()
  const platform = usePlatform()
  const dialog = useDialog()
  const navigate = useNavigate()
  const server = useServer()
  const language = useLanguage()
  const mode = useMode()

  const homedir = createMemo(() => sync.data.path.home)
  const recent = createMemo(() =>
    sync.data.project
      .slice()
      .sort((a, b) => (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created))
      .slice(0, 5),
  )

  const serverDotClass = createMemo(() => {
    const healthy = server.healthy()
    if (healthy === true) return "bg-icon-success-base"
    if (healthy === false) return "bg-icon-critical-base"
    return "bg-border-weak-base"
  })

  function openProject(directory: string) {
    const requestedMode = mode.takePendingMode()
    layout.projects.open(directory)
    server.projects.touch(directory)
    navigate(mode.hrefFor(directory, requestedMode ?? mode.preferredMode(directory)) ?? "/")
  }

  async function chooseProject(target: ModePill) {
    mode.select(PILL_TARGET[target])
    function resolve(result: string | string[] | null) {
      if (!result) {
        mode.cancelPendingMode()
        return
      }
      if (Array.isArray(result)) {
        for (const directory of result) openProject(directory)
        return
      }
      openProject(result)
    }
    if (platform.openDirectoryPickerDialog && server.isLocal()) {
      const result = await platform.openDirectoryPickerDialog?.({
        title: language.t("command.project.open"),
        multiple: true,
      })
      resolve(result)
      return
    }
    dialog.show(
      () => <DialogSelectDirectory multiple={true} onSelect={resolve} />,
      () => {
        mode.cancelPendingMode()
        resolve(null)
      },
    )
  }

  const [pressed, setPressed] = createSignal<ModePill | null>(null)

  function activate(pill: ModePill) {
    setPressed(pill)
    void chooseProject(pill)
  }

  return (
    <div
      data-v110="home"
      data-state={sync.ready ? (sync.data.project.length === 0 ? "empty" : "ready") : "loading"}
    >
      <div data-v110="home-launch">
        <button
          type="button"
          data-v110="home-state-line"
          class="cursor-pointer"
          onClick={() => dialog.show(() => <DialogSelectServer />)}
          aria-label={language.t("command.project.open")}
        >
          <span data-v110="home-state-dot" classList={{ [serverDotClass()]: true }} />
          <span>{server.name}</span>
        </button>

        <h1 data-v110="home-title" data-parity="home.title">
          Get started with Unifia
        </h1>
        <p data-v110="home-subtitle" data-parity="home.subtitle">
          Open a project, resume a recent session, or jump straight into the mode that fits the task.
        </p>

        <div data-v110="home-glance" data-parity="home.glance">
          <div data-v110="home-glance-cell">
            <b>{sync.data.project.length}</b>
            <span>Projects</span>
          </div>
          <div data-v110="home-glance-cell">
            <b>{mode.modes.length}</b>
            <span>Modes</span>
          </div>
          <div data-v110="home-glance-cell">
            <b>{serverDotClass().includes("success") ? "online" : serverDotClass().includes("critical") ? "offline" : "checking"}</b>
            <span>Server</span>
          </div>
        </div>

        <div data-v110="home-composer-card">
          <div data-v110="home-composer-input">
            Ask anything — <b>/</b> for commands, <b>@</b> for context.
          </div>
          <div data-v110="home-composer-bar">
            <div data-v110="home-composer-meta">
              <button type="button" data-v110="home-meta-pill">
                Build
              </button>
              <button type="button" data-v110="home-meta-pill">
                MiniMax-M3
              </button>
              <button type="button" data-v110="home-meta-pill">
                Default
              </button>
            </div>
            <div data-v110="home-composer-actions">
              <button
                type="button"
                aria-label="Open project"
                title="Open project"
                data-v110="home-icon-btn"
                onClick={() => activate("code")}
              >
                <Icon name="folder-add-left" size="small" />
              </button>
              <button
                type="button"
                aria-label="New session"
                title="New session"
                data-v110="home-icon-btn"
                onClick={() => activate("code")}
              >
                <Icon name="plus" size="small" />
              </button>
              <button
                type="button"
                aria-label="Continue"
                title="Continue"
                data-v110="home-send-btn"
                onClick={() => activate("code")}
              >
                <Icon name="arrow-right" size="small" />
              </button>
            </div>
          </div>
        </div>

        <Switch>
          <Match when={recent().length > 0}>
            <div data-v110="home-recent-row" aria-label={language.t("home.recentProjects")}>
              <For each={recent()}>
                {(project) => (
                  <button
                    type="button"
                    data-v110="home-quick-chip"
                    data-home-open-mode="code"
                    onClick={() => openProject(project.worktree)}
                  >
                    <span>{project.worktree.replace(homedir(), "~")}</span>
                    <small>
                      {DateTime.fromMillis(project.time.updated ?? project.time.created).toRelative()}
                    </small>
                  </button>
                )}
              </For>
            </div>
          </Match>
        </Switch>

        <div
          data-v110="home-modes-row"
          aria-label="Modes"
          data-parity="home.modes-row"
        >
          <For each={MODE_PILLS}>
            {(pill) => (
              <button
                type="button"
                data-v110="home-mode-pill"
                data-home-open-mode={pill}
                data-parity="home.mode-pill"
                aria-pressed={pressed() === pill}
                onClick={() => activate(pill)}
              >
                {PILL_LABELS[pill]}
              </button>
            )}
          </For>
        </div>

        <Show when={sync.data.project.length === 0 && sync.ready}>
          <div
            data-v110="home-empty"
            data-state="empty"
            class="mt-2 flex flex-col items-center gap-1"
          >
            <Icon name="folder-add-left" size="large" />
            <div class="text-12-medium text-text-strong">{language.t("home.empty.title")}</div>
            <div class="text-11-regular text-text-weak">{language.t("home.empty.description")}</div>
            <Button class="px-3 mt-1" onClick={() => activate("code")}>
              {language.t("command.project.open")}
            </Button>
          </div>
        </Show>

        <Show when={!sync.ready}>
          <div
            data-v110="home-loading"
            data-state="loading"
            class="mt-2 text-11-regular text-text-weak"
          >
            {language.t("common.loading")}
          </div>
        </Show>

        <div data-v110="home-hint">Click the Unifia logotype at any time to come back to this home.</div>
      </div>
    </div>
  )
}