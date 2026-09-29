<!-- SPDX-License-Identifier: MIT -->
# SHIPPED-REACHABILITY — graphe d'atteignabilité gelé (carte RB04, 2026-09-29)

Généré depuis `scripts/package-wiring.json` + `computeWiring` (`scripts/check-package-wiring.mjs`, imports non-test). Baseline dev@8cf3fac. Ce fichier est un instantané : le garde `check-package-wiring.mjs` reste la source.

## Racines livrées
- `@unifia/app`
- `unifia`
- `@unifia/desktop`
- `@unifia/desktop-electron`
- `@unifia/mobile`

## Atteints (25)
- `@unifia/app`
- `@unifia/artifact-render`
- `@unifia/artifact-runtime`
- `@unifia/automate-migration-tool`
- `@unifia/contracts`
- `@unifia/design-system-runtime`
- `@unifia/desktop`
- `@unifia/desktop-electron`
- `@unifia/digest-runtime`
- `@unifia/expression-runtime`
- `@unifia/mcp-transport`
- `@unifia/memory-runtime`
- `@unifia/mobile`
- `@unifia/plugin`
- `@unifia/sdk-shared`
- `@unifia/skill-hub`
- `@unifia/spec-runtime`
- `@unifia/ui`
- `@unifia/util`
- `@unifia/workbench-server`
- `@unifia/workbench-shell`
- `@unifia/workflow-catalog`
- `@unifia/workflow-runtime`
- `@unifia/workspace-runtime`
- `unifia`

## Déclarés non livrés (27)
| Paquet | Raison déclarée |
|---|---|
| `@unifia/artifact-store` | Tested engine with no importer in shipped code; only release-hardening gates or tests call it, so no product surface reaches it yet. |
| `@unifia/artifact-studio` | Tested engine with no importer in shipped code; only release-hardening gates or tests call it, so no product surface reaches it yet. |
| `@unifia/automate-m0-contract` | ADR-000 qualification only, declared not a production package |
| `@unifia/automate-m0-harness` | ADR-000 qualification harness |
| `@unifia/browser-runtime` | Tested engine with no importer in shipped code; only release-hardening gates or tests call it, so no product surface reaches it yet. |
| `@unifia/capability-runtime` | Tested engine with no importer in shipped code; only release-hardening gates or tests call it, so no product surface reaches it yet. |
| `@unifia/computer-use-safety` | Tested engine with no importer in shipped code; only release-hardening gates or tests call it, so no product surface reaches it yet. |
| `@unifia/desktop-runtime` | Tested engine with no importer in shipped code; only release-hardening gates or tests call it, so no product surface reaches it yet. |
| `@unifia/document-packs` | Tested engine with no importer in shipped code; only release-hardening gates or tests call it, so no product surface reaches it yet. |
| `@unifia/enterprise` | enterprise site deployed separately |
| `@unifia/function` | cloud function deployed separately |
| `@unifia/generative-ui-dom` | Tested engine with no importer in shipped code; only release-hardening gates or tests call it, so no product surface reaches it yet. |
| `@unifia/mcp-ui-actions` | Tested engine with no importer in shipped code; only release-hardening gates or tests call it, so no product surface reaches it yet. |
| `@unifia/media-runtime` | Tested engine with no importer in shipped code; only release-hardening gates or tests call it, so no product surface reaches it yet. |
| `@unifia/memory-governance` | Tested engine with no importer in shipped code; only release-hardening gates or tests call it, so no product surface reaches it yet. |
| `@unifia/observability` | Tested engine with no importer in shipped code; only release-hardening gates or tests call it, so no product surface reaches it yet. |
| `@unifia/release-hardening` | release gates and qualification scenarios |
| `@unifia/remote-bridge` | Tested engine with no importer in shipped code; only release-hardening gates or tests call it, so no product surface reaches it yet. |
| `@unifia/runtime-conformance` | conformance test harness |
| `@unifia/sandbox-drivers` | Tested engine with no importer in shipped code; only release-hardening gates or tests call it, so no product surface reaches it yet. |
| `@unifia/scheduler` | Tested engine with no importer in shipped code; only release-hardening gates or tests call it, so no product surface reaches it yet. |
| `@unifia/script` | build and release tooling |
| `@unifia/secret-broker` | Tested engine with no importer in shipped code; only release-hardening gates or tests call it, so no product surface reaches it yet. |
| `@unifia/slack` | Slack bot deployed separately |
| `@unifia/storybook` | component workshop, dev only |
| `@unifia/web` | documentation site (Astro) |
| `@unifia/workbench-orchestrator` | Tested engine with no importer in shipped code; only release-hardening gates or tests call it, so no product surface reaches it yet. |
