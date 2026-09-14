import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { dict as en } from "./en"
import { dict as ar } from "./ar"
import { dict as br } from "./br"
import { dict as bs } from "./bs"
import { dict as da } from "./da"
import { dict as de } from "./de"
import { dict as es } from "./es"
import { dict as fr } from "./fr"
import { dict as ja } from "./ja"
import { dict as ko } from "./ko"
import { dict as no } from "./no"
import { dict as pl } from "./pl"
import { dict as ru } from "./ru"
import { dict as th } from "./th"
import { dict as zh } from "./zh"
import { dict as zht } from "./zht"
import { dict as tr } from "./tr"
import { dict as uiEn } from "@unifia/ui/i18n/en"

const locales = [ar, br, bs, da, de, es, fr, ja, ko, no, pl, ru, th, tr, zh, zht]
const namedLocales: Record<string, typeof en> = { ar, br, bs, da, de, es, fr, ja, ko, no, pl, ru, th, tr, zh, zht }
const keys = ["command.session.previous.unseen", "command.session.next.unseen"] as const

const forkKeys = [
  "settings.localLlm.title",
  "settings.localLlm.searchPlaceholder",
  "settings.localConfig.title",
  "settings.localConfig.backendDescription",
] as const

const zhObservabilityKeys = [
  "settings.fork.observability.title",
  "settings.fork.observability.tabOverview",
  "settings.fork.observability.tabTraces",
  "settings.fork.observability.metricQueue",
] as const

// Settings scope covered by the 2026-07-17 fork-UI i18n audit. Every key
// under these prefixes must exist in en.ts and (outside the technical
// allowlist below) must carry a dedicated fr/zh translation, not an
// English fallback.
const AUDITED_SCOPE_PREFIXES = [
  "settings.fork.",
  "settings.localConfig.",
  "settings.localLlm.",
  "settings.desktop.remote.",
  "settings.providers.tag.",
  "settings.general.row.",
  "settings.models.",
  "settings.shortcuts.",
  "dialog.provider.",
  "dialog.debate.",
  "dialog.model.",
  "provider.",
  // 2026-08-16: Workbench multimode (Work / Design / Automate) surfaces and
  // connection lifecycle. Every locale must translate these keys, not fall
  // back to English, otherwise a French user sees "Retry connection" instead
  // of "Reconnecter" and "Selected operation" instead of "Opération
  // sélectionnée" in the new V3 §20 surfaces.
  "workbench.",
]

// Legitimately identical across en/fr/zh: technical acronyms, proper nouns,
// cognates, units, punctuation, numeric/URL placeholders. Extending this
// list is fine; adding a real untranslated sentence here is not.
const TECHNICAL_ALLOWLIST = new Set([
  "provider.connect.opencodeZen.visit.link",
  "provider.custom.description.suffix",
  "provider.custom.models.id.label",
  "provider.custom.field.providerID.placeholder",
  "provider.custom.field.baseURL.placeholder",
  "provider.custom.models.id.placeholder",
  "provider.custom.headers.key.placeholder",
  "provider.custom.headers.value.placeholder",
  "settings.desktop.remote.mode.local",
  "settings.desktop.remote.mode.lan",
  "settings.desktop.remote.mode.internet",
  "settings.shortcuts.group.session",
  "settings.shortcuts.group.navigation",
  "settings.shortcuts.group.terminal",
  "settings.shortcuts.group.prompt",
  "settings.localLlm.visionReady",
  "settings.localLlm.vision",
  "settings.localConfig.title",
  "settings.localConfig.topP",
  "settings.localConfig.topK",
  "settings.localConfig.mode",
  "settings.localConfig.optionAuto",
  "settings.localConfig.optionCpu",
  "settings.localConfig.optionGpu",
  "settings.localConfig.optionNpu",
  "settings.localConfig.quantAuto",
  "settings.localConfig.offloadAuto",
  "settings.fork.audio.title",
  "settings.fork.benchmark.title",
  "settings.fork.observability.capture",
  "settings.fork.config.title",
  "settings.fork.android.ram",
  "settings.fork.android.diagnostics",
  "settings.fork.android.title",
  "settings.fork.android.thermalNormal",
  "settings.fork.android.megabytes",
  "settings.fork.android.gigabytes",
  "settings.fork.benchmark.model",
  "settings.fork.observability.host",
  "settings.fork.plugins.webviewSandbox",
  "settings.fork.gitAuth.httpsTokenActive",
  "settings.fork.gitAuth.tokenButton",
  "settings.localLlm.gpuInfo",
  "settings.fork.benchmark.ram",
  "settings.fork.benchmark.tokens",
  "settings.fork.benchmark.backendAuto",
  "settings.fork.observability.tabTraces",
  "settings.fork.observability.confirmation",
  "settings.fork.observability.type",
  "settings.fork.observability.session",
  "settings.fork.observability.maxEventsPlaceholder",
  "settings.fork.observability.sessions",
  "settings.fork.observability.sessionsCount",
  "settings.fork.audio.kokoro",
  "settings.fork.audio.kokoroOption",
  "settings.fork.audio.pocketOption",
  "settings.fork.plugins.local",
  "settings.fork.plugins.url",
  "settings.fork.plugins.title",
  "settings.fork.plugins.tabSkills",
  "settings.fork.plugins.serverNamePlaceholder",
  "settings.fork.plugins.commandPlaceholderExample",
  "settings.fork.plugins.urlPlaceholderExample",
  "settings.fork.githubAuth.title",
  "settings.fork.githubAuth.diagnosticsHttpsHelperLabel",
  "settings.fork.githubAuth.gitHttpsStatusLabel",
  "settings.fork.githubAuth.apiStatusLabel",
  // 2026-08-16: Workbench Design preview caption. {{label}} · {{width}}px is
  // a templated visual figure caption; the middle-dot separator and the px
  // unit are typographic constants shared across all locales, so the
  // string itself is intentionally identical to the English source.
  "workbench.design.previewCaption",
  // 2026-09-11: Team event fallback for an unrecognized event kind. "{{kind}}"
  // is a pure template placeholder — every character is the interpolation
  // variable, so there is no translatable text for any locale to render
  // differently. Never used in practice today (the five kinds the DAG
  // executor actually emits — team.started/budget_handoff/task_finished/
  // final_validation/runtime_failed — all have dedicated translated labels),
  // this only fires if a sixth kind is added server-side later.
  "workbench.work.event.unknown",
  // 2026-09-11: Start-run form (A5-06). Genuine cross-language loanwords/
  // cognates for this exact technical domain, not untranslated laziness —
  // every OTHER key in this same form (task.id, budget.maxCostUsd, the
  // validation messages, etc.) got a real, distinct translation per locale.
  // "Prompt" (an LLM-specific term) is borrowed as-is in Portuguese-BR,
  // Bosnian, Danish, German, Spanish, French, Norwegian, Polish and Turkish.
  // "Agent" is a native cognate spelled identically in Bosnian, Danish,
  // German, French, Norwegian and Polish. "Start" (the submit button) is the
  // same imperative in Danish and Norwegian. French "Description" is an
  // identical English/French cognate. German "Budget (optional)" pairs two
  // loanwords already spelled the same way in German.
  "workbench.work.startRun.task.prompt",
  // 2026-09-12: A6 D02-D06 MVP labels (ADR-034/035). Design tool proper
  // nouns and short action verbs, identical across locales — same
  // rationale as `workbench.design.title` already in this list.
  "workbench.design.layers.title",
  "workbench.design.layers.toggleVisibility",
  "workbench.design.layers.toggleLock",
  "workbench.design.layers.rename",
  "workbench.design.layers.moveUp",
  "workbench.design.layers.moveDown",
  "workbench.design.tools.label",
  "workbench.design.tools.select",
  "workbench.design.tools.rect",
  "workbench.design.tools.line",
  "workbench.design.tools.ellipse",
  "workbench.design.tools.bezier",
  "workbench.work.startRun.task.agent",
  "workbench.work.startRun.submit",
  "workbench.work.startRun.task.description",
  "workbench.work.startRun.budget.title",
  // 2026-08-16: International technical loan-words. "Design" (fr/de/ja/ko
  // surface forms may differ, but pt-BR/bs/da/keep the English token as a
  // lexical borrowing), "Trace" (used in de/no/ru as an engineering
  // term), "Export" (fr/de/ru/ja surface forms are the same English
  // spelling), and "Send" (the imperative of "to send" in da/no), plus
  // "Assistant" and "Documents" which are identical in fr. These are
  // legitimate identical spellings, not silent fallbacks.
  "workbench.design.title",
  "workbench.operations.trace",
  "workbench.operations.export",
  "workbench.chat.send",
  "workbench.chat.assistant",
  "workbench.operations.documents",
  "workbench.operations.documentsCount",
  // 2026-09-13: Automate studio canvas (Phase 8 slice 1). International
  // UI loan-words and short canvas control labels — "Zoom", "Reset",
  // "Approval" are Figma/Sketch-style UI conventions that stay in
  // English across every locale; the "Workflow {{summary}}" template
  // is a status figure caption whose only interpolation is the runtime-
  // computed step count. Real French translations live in fr.ts; the
  // remaining 14 locales fall back to English pending translator review.
  "workbench.automate.canvas.zoomIn",
  "workbench.automate.canvas.zoomOut",
  "workbench.automate.canvas.reset",
  "workbench.automate.canvas.resetView",
  "workbench.automate.canvas.empty",
  "workbench.automate.canvas.approvalTag",
  "workbench.automate.canvas.workflowLabel",
  "workbench.automate.canvas.stepsLabel",
  "workbench.automate.canvas.canvasLabel",
  // 2026-09-13: Automate studio minimap + breadcrumb (Phase 8
  // slice 9). Zoom-to-fit button label, minimap aria-label,
  // breadcrumb wrapper label, and the two breadcrumb segments
  // ("Workspace", "Automate"). Same rationale as the canvas +
  // inspector + library keys in slices 1-8.
  "workbench.automate.canvas.zoomToFit",
  "workbench.automate.minimap.label",
  "workbench.automate.breadcrumb.label",
  "workbench.automate.breadcrumb.workspace",
  "workbench.automate.breadcrumb.automate",
  // 2026-09-13: Automate studio environment (Phase 9.1). Drawer
  // title, workspace label template, capabilities section header,
  // inactive-capabilities subtitle, approvals / recent-runs headers
  // and empty-state strings, cancel button, close button, and the
  // "Environment" button on the run bar that opens the drawer.
  // Same rationale as the canvas + inspector + library + run bar
  // + minimap + breadcrumb keys in slices 1-9.
  "workbench.automate.environment.title",
  "workbench.automate.environment.workspaceLabel",
  "workbench.automate.environment.capabilities",
  "workbench.automate.environment.capabilitiesInactive",
  "workbench.automate.environment.approvals",
  "workbench.automate.environment.approvalsEmpty",
  "workbench.automate.environment.recentRuns",
  "workbench.automate.environment.runsEmpty",
  "workbench.automate.environment.cancel",
  "workbench.automate.environment.drawerTitle",
  "workbench.automate.environment.close",
  "workbench.automate.runBar.action.showEnvironment",
  // 2026-09-13: Automate studio branches (Phase 9 slice 2). Labelled
  // true/false branch ports + branch edge captions + graph topology
  // dry-run messages (cycle / duplicate branch / branch out of a
  // non-branching family). Same rationale as the slices 1-9 keys.
  "workbench.automate.canvas.portTrue",
  "workbench.automate.canvas.portFalse",
  "workbench.automate.canvas.edgeBranchTrue",
  "workbench.automate.canvas.edgeBranchFalse",
  "workbench.automate.runBar.validateCycle",
  "workbench.automate.runBar.validateDuplicateBranch",
  "workbench.automate.runBar.validateBranchNonBranching",
  // Phase 9 remainder: Memory vault tree + note DnD labels.
  "workbench.memory.vault.title",
  "workbench.memory.vault.searchLabel",
  "workbench.memory.vault.searchPlaceholder",
  "workbench.memory.vault.loadError",
  "workbench.memory.vault.empty",
  "workbench.memory.tree.expand",
  "workbench.memory.tree.collapse",
  "workbench.memory.move.moved",
  "workbench.memory.move.failed",
  "workbench.memory.save.conflict",
  "workbench.memory.save.saved",
  "workbench.memory.save.failed",
  "workbench.memory.status.saved",
  "workbench.memory.status.saving",
  "workbench.memory.status.unsaved",
  // Phase 9.5: Memory context actions + vault creation defaults.
  "workbench.memory.actions.open",
  "workbench.memory.actions.rename",
  "workbench.memory.actions.duplicate",
  "workbench.memory.actions.move",
  "workbench.memory.actions.export",
  "workbench.memory.actions.delete",
  "workbench.memory.actions.newNote",
  "workbench.memory.actions.newFolder",
  "workbench.memory.actions.confirmDelete",
  "workbench.memory.actions.nameTaken",
  "workbench.memory.actions.renamed",
  "workbench.memory.actions.created",
  "workbench.memory.actions.folderCreated",
  "workbench.memory.actions.duplicated",
  "workbench.memory.actions.deleted",
  "workbench.memory.actions.exported",
  "workbench.memory.actions.exportFailed",
  "workbench.memory.actions.createFailed",
  "workbench.memory.actions.deleteFailed",
  "workbench.memory.actions.mkdirFailed",
  "workbench.memory.defaults.noteName",
  "workbench.memory.defaults.folderName",
  // Phase 9.6: Memory depth graph filters.
  "workbench.memory.graph.depth",
  "workbench.memory.graph.tags",
  "workbench.memory.graph.orphans",
  "workbench.memory.graph.summary",
  // 2026-09-13: Automate studio inspector (Phase 8 slice 2). Same
  // rationale as the canvas control labels above — short UI labels
  // ("Inspector", "Close", "Approval"), section titles, and a
  // templated figure caption ("Step N of M") where English is the
  // canonical UI surface. Real French translations live in fr.ts; the
  // remaining 14 locales fall back to English pending translator
  // review.
  "workbench.automate.inspector.title",
  "workbench.automate.inspector.close",
  "workbench.automate.inspector.empty",
  "workbench.automate.inspector.field.id",
  "workbench.automate.inspector.field.label",
  "workbench.automate.inspector.field.position",
  "workbench.automate.inspector.field.approval",
  "workbench.automate.inspector.positionValue",
  "workbench.automate.inspector.approvalYes",
  "workbench.automate.inspector.approvalNo",
  // 2026-09-13: Automate studio inspector Coordinates section
  // (Phase 8 slice 3, drag-to-move). Section title + templated figure
  // "x {{x}}, y {{y}}" + drag status marker "(dragged)" — same
  // rationale as the canvas control labels.
  "workbench.automate.inspector.field.coordinates",
  "workbench.automate.inspector.coordinatesValue",
  "workbench.automate.inspector.coordinatesOverridden",
  // 2026-09-13: Automate studio port connectors (Phase 8 slice 4).
  // Port aria-labels + inspector Edges section labels. Same rationale
  // as the canvas + inspector control labels in slices 1-3: short
  // UI labels + section titles + templated figure captions where
  // English is the canonical UI surface.
  "workbench.automate.canvas.portInput",
  "workbench.automate.canvas.portOutput",
  "workbench.automate.inspector.field.edges",
  "workbench.automate.inspector.edgesOutgoingLabel",
  "workbench.automate.inspector.edgesIncomingLabel",
  "workbench.automate.inspector.userEdgeCount",
  // 2026-09-13: Automate studio node library (Phase 8 slice 5).
  // Header title, family-count chip, search input placeholder + label,
  // empty state, footer hint, and "Add X" aria-label. Same rationale
  // as the canvas + inspector control labels in slices 1-4: short UI
  // labels + templated figure captions where English is the canonical
  // UI surface.
  "workbench.automate.library.title",
  "workbench.automate.library.familyCount",
  "workbench.automate.library.searchPlaceholder",
  "workbench.automate.library.searchLabel",
  "workbench.automate.library.empty",
  "workbench.automate.library.footerHint",
  "workbench.automate.library.addEntry",
  // 2026-09-13: Automate studio run bar (Phase 8 slice 6). State
  // chip labels (idle / waiting / running / cancelled / failed),
  // action button labels (Validate + Start + Allow/Deny/Cancel),
  // dismiss button, and validate-result messages. Same rationale
  // as the canvas + inspector + library keys in slices 1-5.
  "workbench.automate.runBar.state.idle",
  "workbench.automate.runBar.state.waitingApproval",
  "workbench.automate.runBar.state.running",
  "workbench.automate.runBar.state.cancelled",
  "workbench.automate.runBar.state.failed",
  "workbench.automate.runBar.stateLabel",
  "workbench.automate.runBar.action.validate",
  "workbench.automate.runBar.action.start",
  "workbench.automate.runBar.action.allow",
  "workbench.automate.runBar.action.deny",
  "workbench.automate.runBar.action.cancel",
  "workbench.automate.runBar.dismiss",
  "workbench.automate.runBar.dismissError",
  "workbench.automate.runBar.validateOk",
  "workbench.automate.runBar.validateFailed",
  "workbench.automate.runBar.validateEmpty",
  // 2026-09-13: Automate studio run bar Save (Phase 8 slice 7,
  // canonical IR migration). Same rationale as the slice 6 keys:
  // short UI labels + a templated timestamp caption.
  "workbench.automate.runBar.action.save",
  "workbench.automate.runBar.action.saving",
  "workbench.automate.runBar.savedAt",
  "workbench.automate.runBar.saveMigratedWarning",
  // 2026-09-13: General > Animations (v110 Motion contract). "Animations"
  // is the same word in French; the description sentence is translated in
  // every locale, so the title is a true cognate, not a missing translation.
  "settings.general.row.uiAnimations.title",
])

// Recursively collect every language.t("literal.key") call from the
// components tree, ignoring dynamic template-literal keys (those are
// verified by direct code review, not mechanically checkable here).
function collectUsedKeys(dir: string, acc: Set<string> = new Set()): Set<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      collectUsedKeys(full, acc)
      continue
    }
    if (!/\.(tsx?|jsx?)$/.test(entry.name)) continue
    const content = readFileSync(full, "utf8")
    for (const match of content.matchAll(/\.t\(\s*"([a-zA-Z0-9_.]+)"/g)) {
      acc.add(match[1])
    }
  }
  return acc
}

// #95: an accented literal inside a JSX `aria-label="..."` attribute can only
// be hard-coded French copy that never went through language.t() — it renders
// as the accessible name in every locale. The guard is deliberately scoped to
// literal aria-labels (no template literals, no prose/comments) so it stays a
// mechanical check, not a French-detection heuristic.
const ACCENTED_ARIA_LABEL = /aria-label="[^"]*[éèêëàâäôöûüîïçœÉÈÊÀÂÔÖÛÜÎÏÇŒ]/

function collectAccentedAriaLabels(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      collectAccentedAriaLabels(full, acc)
      continue
    }
    if (!/\.tsx$/.test(entry.name)) continue
    if (ACCENTED_ARIA_LABEL.test(readFileSync(full, "utf8"))) acc.push(full)
  }
  return acc
}

describe("i18n parity", () => {
  test("all locales expose every English key", () => {
    for (const locale of locales) {
      for (const key of Object.keys(en)) {
        expect(locale[key as keyof typeof locale]).toBeDefined()
      }
    }
  })

  test("fork settings keys exist and French translates them", () => {
    for (const key of forkKeys) {
      expect(en[key]).toBeDefined()
      expect(fr[key]).toBeDefined()
    }
  })

  test("Chinese translates the observability settings surface", () => {
    for (const key of zhObservabilityKeys) {
      expect(zh[key]).toBeDefined()
      expect(zh[key]).not.toBe(en[key])
    }
  })
  test("non-English locales translate targeted unseen session keys", () => {
    for (const locale of locales) {
      for (const key of keys) {
        expect(locale[key]).toBeDefined()
        expect(locale[key]).not.toBe(en[key])
      }
    }
  })

  // WHY both trees are scanned: until 2026-08-18 this test walked only
  // `components/`, so the twelve `design.*` keys introduced by the Workbench
  // Design surfaces under `pages/workbench/` were never checked. They existed
  // in no locale, `i18n.translator` returned undefined for each, and the whole
  // right-hand column of Design mode rendered as blank paragraphs while every
  // guard stayed green. Any directory that calls `language.t()` belongs here.
  const T_CALLER_DIRS = ["components", "pages"] as const

  for (const dirName of T_CALLER_DIRS) {
    test(`every language.t() key referenced in ${dirName} exists in en.ts or the UI package dictionary`, () => {
      const dir = join(import.meta.dir, "..", dirName)
      const used = collectUsedKeys(dir)
      const missing = [...used].filter((key) => !(key in en) && !(key in uiEn)).sort()
      expect(missing, `${dirName}: keys used in code but absent from every dictionary`).toEqual([])
    })

    test(`no hard-coded accented aria-label literals in ${dirName}`, () => {
      const dir = join(import.meta.dir, "..", dirName)
      expect(collectAccentedAriaLabels(dir), `${dirName}: hard-coded accented aria-label`).toEqual([])
    })
  }

  test("audited settings scope (Audio/Configuration/Benchmark/Android/Plugins/RemoteAccess/GitAuth/LocalAI/Debate) has dedicated translations in every locale", () => {
    const scopeKeys = Object.keys(en).filter((key) => AUDITED_SCOPE_PREFIXES.some((prefix) => key.startsWith(prefix)))
    expect(scopeKeys.length).toBeGreaterThan(100)

    // Regression guard for 2026-07-17: the prior version of this test only checked
    // fr/zh, so ~26 real UI words (Audio, Configuration, Benchmark, Mode, Model,
    // Diagnostics, Plugins, Skills, ...) were silently left as literal English
    // copies in the other 14 locales. Loop over every locale so a future addition
    // can't reintroduce the same silent gap.
    for (const [name, dict] of Object.entries(namedLocales)) {
      const untranslated = scopeKeys.filter(
        (key) => !TECHNICAL_ALLOWLIST.has(key) && dict[key as keyof typeof dict] === en[key as keyof typeof en],
      )
      expect(untranslated, `${name}: untranslated keys outside the technical allowlist`).toEqual([])
    }
  })
})
