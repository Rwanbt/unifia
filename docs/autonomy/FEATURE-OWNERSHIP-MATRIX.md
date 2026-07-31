# FEATURE-OWNERSHIP-MATRIX.md

**Phase :** -1 (Audit comparatif)
**Statut :** `VERIFIED_LOCAL` — assignations basées sur l'inspection des README et architectures
**Date :** 2026-07-31

## 1. Légende des autorités (Plan V3 §5)

| Code | Autorité |
|---|---|
| **CORE** | Unifia Core (AgentRuntime, SessionRuntime, ToolRuntime, ProviderRuntime, MCPRuntime, ModelRouter, ContextRuntime, EventRuntime) |
| **WB** | Unifia Workbench (Workspace UI, Documents, Artifacts, Browser, Computer Use, Remote Bridges, Search, Capability Hub, Trace, Approvals) |
| **APP** | Application services (WorkspaceRuntime, ArtifactRuntime, WorkflowRuntime, MemoryRuntime, CapabilityRegistry, RemoteRuntime, DesktopAutomationBroker) |
| **GOV** | Trust and Governance (PolicyEngine, ApprovalBroker, SecretStore, AuditRuntime, CapabilityEngine, TaintTracker, Quotas, KillSwitches) |
| **BACK** | Execution backends (Native restricted, Docker, WSL2, Lima, Browser profile, Document workers, External MCP, Local models) |

## 2. Matrice feature → propriétaire canonique

| Domaine | Fork Unifia (Rwanbt) | OpenWork (upstream) | Open Cowork (upstream) | Autorité cible Unifia |
|---|---|---|---|---|
| **Runtime agentique (boucle)** | `packages/opencode/src/runtime/` (existant) | `apps/server/` + côté OpenCode embarqué | `agent runner` (NE PAS reprendre — Plan V3 §3.2) | **CORE** |
| **Session manager** | `packages/opencode/src/session/` | `apps/server/sessions` | NE PAS reprendre | **CORE** |
| **Provider routing** | `packages/opencode/src/provider/` (10 fichiers TS) | probable côté OpenCode | NE PAS reprendre | **CORE** |
| **Provider MiniMax (M3)** | à ajouter | ❌ | ❌ | **CORE** (BD-6) |
| **Tools (MCP, registry)** | `packages/opencode/src/tool/`, `mcp/` | `apps/server/mcp` | probable | **CORE** |
| **Memory** | `packages/opencode/src/memory/` (à confirmer) | `apps/server/memory` | NE PAS reprendre tel quel → migrer idées vers MemoryRuntime | **APP** (MemoryRuntime) |
| **Workspace identity** | `packages/opencode/src/workspace/` (à confirmer) | `apps/server/workspaces` | `ROADMAP.md` mentionne workspaces | **APP** (WorkspaceRuntime) |
| **File sessions** | probable | `apps/server/file-sessions` | ❌ | **APP** (WorkspaceRuntime) |
| **Multi-workspace** | ❌ (mono) | ✅ (multi-app + workspaces) | probable | **APP** (WorkspaceRuntime) |
| **Artifacts (DOCX, PPTX, XLSX, PDF)** | ❌ (XSD 78 fichiers dans Open Cowork, pas dans Unifia) | probable (XSD-like) | ✅ (78 `.xsd` = schémas de docs) | **APP** (ArtifactRuntime) + **Capability Packs** |
| **Skills (manifest typé)** | `packages/opencode/src/skill/` (à confirmer) | `apps/server/skills` | probable | **APP** (CapabilityRegistry) |
| **Permissions / Policy** | `packages/opencode/src/permission/` | probable | probable | **GOV** (PolicyEngine) |
| **Approvals** | `packages/opencode/src/approval/` (à confirmer) | `apps/server/approvals` | probable | **GOV** (ApprovalBroker) |
| **Secrets** | probable | `.infisical.json` (externe) | probable | **GOV** (SecretStore) |
| **Audit / EventLog** | probable | `STATS.md` (télémétrie) | probable | **GOV** (AuditRuntime) |
| **Trace Panel** | probable | `apps/desktop/` UI | probable (sandbox) | **WB** (Trace UI alimenté par EventLog) |
| **Permission dialogs** | probable | `apps/desktop/permission-dialog` | probable | **WB** (ApprovalBroker UI) |
| **Browser profile** | ❌ | probable | probable | **BACK** (Browser profile) |
| **Computer use** | ❌ | probable | probable (Python scripts) | **WB** (Computer Use) + **BACK** (DesktopAutomationBroker) |
| **Sandbox Docker** | probable (`.github/workflows/containers.yml`) | probable | probable | **BACK** (SandboxBroker) |
| **Sandbox WSL2/Lima** | ❌ | probable | probable (Python) | **BACK** (SandboxBroker) |
| **Remote bridges (Slack/Feishu)** | `packages/slack/` (1 package) | probable (Slack probable) | `eigent-ai/eigent` mentionne Feishu | **WB** (RemoteRuntime) |
| **Remote commands authorization** | probable | `apps/server/remote` | probable | **GOV** (RemoteTransport) |
| **Desktop shell (UI)** | `packages/app/` (SolidJS), `packages/desktop/` (Tauri), `packages/desktop-electron/` (legacy) | `apps/desktop/` | probable | **WB** (Shell Unifia) |
| **CLI** | `packages/opencode/bin/opencode` | probable | probable | **WB** (CLI Unifia) |
| **i18n** | 21 langues (en, fr, de, …) dans `packages/desktop/src/i18n/*.ts` + racine | `TRANSLATIONS.md` probable | probable (à vérifier) | **WB** (Shell i18n) — cf. `P-1-I18N-USER-SOURCE` |
| **Mobile iOS/Android** | `packages/mobile/` (Tauri 2) | Swift natif (12 fichiers) | probable | **WB** (mobile) |
| **macOS natif** | (Tauri) | Swift natif | probable | **WB** (Tauri préféré) |
| **Test harness / conformance** | `bun test`, `turbo typecheck` | probable (Turborepo) | probable (vite build) | **CORE** (Conformance suite Phase 1) |
| **CI workflows** | 42 `.github/workflows/*.yml` | probable | 12 `.yml` | **CORE** (CI Unifia) |

## 3. Doublons fonctionnels détectés (à arbitrer en Phase 2)

| Domaine | Fork Unifia | OpenWork | Open Cowork | Décision |
|---|---|---|---|---|
| Server headless | ❌ (pas dans Rwanbt) | ✅ `apps/server/` | ❌ | **ADOPT** OpenWork |
| Agent loop | `packages/opencode/src/runtime/` | ✅ OpenCode embarqué | ❌ | **ADAPT** (Unifia RuntimeAdapter) |
| Provider management | `packages/opencode/src/provider/` | probable | ❌ | **CORE** (unifier dans Unifia Core) |
| Skills/plugins | `packages/opencode/src/skill/` | `apps/server/skills` | probable | **ADOPT** OpenWork + Capability Packs |
| Remote transport | ❌ | `apps/server/remote` | Feishu/Slack | **ADOPT** OpenWork + **ADAPT** Open Cowork |
| Browser control | ❌ | probable | probable | **ADAPT** tardif (Phase 10) |
| Computer use | ❌ | probable | probable (Python) | **ADAPT** tardif (Phase 10) avec broker |
| Tauri vs Electron | **DOUBLON** : Tauri (`desktop/`) + Electron (`desktop-electron/`) | Tauri probable | Electron probable | **DEPRECATE** desktop-electron (BD-3) |
| macOS natif (Swift) | ❌ | ✅ | ❌ | **DEFER** (post Phase 19) |

## 4. Hiérarchie d'autorité finale (à implémenter Phase 2-3)

```text
CORE (Unifia Core)
├── AgentRuntime (un seul — Unifia Core)
├── SessionRuntime
├── ToolRuntime
├── ProviderRuntime (inclut MiniMax M3, OpenAI, Anthropic, etc.)
├── MCPRuntime
├── ModelRouter
├── ContextRuntime
├── EventRuntime
└── RuntimeAdapter (3 impls : Unifia, OpenCode legacy, Fake)
    ↓ interface vers Workbench

APP (Application services)
├── WorkspaceRuntime
├── ArtifactRuntime
├── WorkflowRuntime
├── MemoryRuntime
├── CapabilityRegistry (Porte d'entrée pour les skills)
├── RemoteRuntime
└── DesktopAutomationBroker
    ↓ interface vers UI

GOV (Trust and Governance)
├── PolicyEngine
├── ApprovalBroker
├── SecretStore
├── AuditRuntime
├── CapabilityEngine
├── TaintTracker
├── Quotas
└── KillSwitches
    ↓ applique default-deny

WB (Workbench)
├── Shell Unifia (Code | Work | Design | Automate)
├── Documents / Artifacts
├── Browser profile
├── Computer Use
├── Remote Bridges
├── Trace Panel
├── Approval UI
└── Capability Hub
    ↓ interface utilisateur

BACK (Execution backends)
├── Native restricted
├── Docker
├── WSL2 / Lima
├── Browser profile
├── Document workers
├── External MCP
└── Local models
```

## 5. Règle d'autorité (rappel Plan V3 §5)

```text
aucun module importé ne conserve sa propre autorité parallèle.
```

Conséquence concrète : tout import OpenWork ou Open Cowork doit **refactorer** les autorités en doublon pour les rattacher à l'autorité canonique Unifia.
