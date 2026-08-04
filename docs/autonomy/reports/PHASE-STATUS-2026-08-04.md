<!-- SPDX-License-Identifier: MIT -->
# Unifia V3 — état des phases au 2026-08-04

Reconstruit depuis le plan canonique `Plan-directeur-V3-Unifia-WorkBench-OpenWork-OpenCowork.md`,
le handoff Hermes et une lecture directe du code de `D:\App\OpenCode\unifia-execution-clean`.

## Convention de statut

| Statut | Signification |
|---|---|
| `PASS local` | Preuve reproductible sur cette machine (test, typecheck, gate). Ce n'est **pas** une preuve de production. |
| `PARTIEL` | Une partie du livrable existe et est prouvée ; le reste est nommé explicitement. |
| `NON FAIT` | Aucun livrable, ou seulement un document d'intention. |
| `BLOQUÉ EXTERNE` | Nécessite une autorité, un service ou un matériel hors de cette machine. |

**Règle appliquée** : un statut sans preuve citable est écrit `NON PROUVÉ`, jamais `PASS`.

## Tableau

| Phase | Livrable du plan | Statut | Preuve / raison |
|---|---|---|---|
| −2 | Audit licences et provenance | `PARTIEL` | `LICENSE-AUDIT-*`, `UPSTREAM-SOURCES.lock.json`, `DO-NOT-IMPORT.md` présents. Gate automatisé ajouté ce jour : `supply-chain/forbidden-paths`, `excluded-imports`, `spdx-headers`, `manifest-licenses`, `dependency-provenance` — 5/5 PASS. Revue juridique externe : `BLOQUÉ EXTERNE`. |
| −1 | Audit comparatif tri-repo | `PARTIEL` | Six matrices corrigées (commit `375467a`), preuves path-level dans `M1-PATH-EVIDENCE`. Les affirmations non vérifiées sont normalisées `UNVERIFIED`. |
| 0 | Rebrand, gouvernance, upstream | `PARTIEL` | Rebrand desktop/mobile fait (`bb5827c`). Le hook pre-commit `.husky/pre-commit` applique chemins interdits + `.env` + SPDX. |
| 1 | CI, tests, builds, harness multi-runtime | `PARTIEL` | `FakeRuntimeAdapter` + `OpenCodeRuntimeAdapter` présents et testés. **Gate CI ajouté ce jour** : `.github/workflows/unifia-conformance.yml`. Conformance suite du plan §13 (10 scénarios sur 3 runtimes) : `NON FAIT`. |
| 2 | Contrats Unifia et adaptateurs | `PASS local` | `@unifia/contracts` : 6 ports, suites vitest 32/32 + smokes. Typecheck monorepo 21/21. Négociation de version et compat N−1 : `NON FAIT`. |
| 3 | Security foundation, capabilities, ApprovalBroker | `PASS local` | `PolicyEngineDouble`, `ApprovalBroker` 5/5, `CapabilityRegistry` 6/6, `SecretStore`/`KillSwitchRegistry`. Bijection capability↔effet désormais vérifiée (corrigée ce jour : l'assertion était figée à 14 et périmée). |
| 4 | WorkspaceRuntime, stockage, migrations | `PASS local` | `WorkspaceRuntime` 12/12, `DurableQueue` 4/4, `WorkspaceStorage` 12/12 dont **8 checks de conformance migration ajoutés ce jour**. Défaut de perte de données corrigé (`7ff7dd1`). |
| 5 | Extraction OpenWork (serveur, orchestrateur) | `PASS local` (serveur) / `PARTIEL` | `WorkbenchServer` 72/72 + **`WorkbenchBootstrap` 39/39 sur HTTP réel** (`5590c9d`) : le serveur est désormais un processus, avec écoute loopback, audit JSONL durable et arrêt propre. Le critère « le serveur fonctionne headless » est atteint localement. Orchestrateur et MultiWorkspaceRouter : `NON FAIT`. |
| 6 | Documents et artefacts bureautiques | `PASS local` | `DocumentPackRegistry` 6/6, six packs, workers réseau `off`, golden hashes, `inspectStoredZip` anti zip-slip/bombe. |
| **Gate A** | Workbench headless stable | `NON PROUVÉ` | Critères techniques largement couverts localement, mais §19 exige des adapters conformes à une suite de conformance qui n'existe pas, et aucune exécution headless réelle n'est démontrée. |
| 7 | Shell Unifia Code/Work | `NON PROUVÉ` | Rebrand fait ; l'expérience Work V1 (§20) n'est pas démontrée. |
| 8 | SandboxBroker multi-backend | `PARTIEL` | `SandboxBroker` 4/4 + conformance driver 4/4, network open refusé, mounts allowlistés. **Drivers réels** (docker/wsl2/lima) : `NON FAIT`. |
| 9 | Remote bridges contrôlés | `PARTIEL` | `RemoteBridgeBroker` 7/7, adapters Slack et Feishu avec signature, anti-rejeu, kill switches. Intégration Bolt réelle et route Worker persistante : `NON FAIT`. |
| 10 | Browser et Computer Use | `PARTIEL` | `BrowserAutomationBroker`, `DesktopAutomationBroker` 3/3, emergency stop 1/1. E2E navigateur réel exclu du gate (raison déclarée). Tests d'injection visuelle : `NON FAIT`. |
| **Gate B** | Cowork local-first sécurisé | `NON PROUVÉ` | Dépend des drivers sandbox réels et des tests d'injection visuelle. |
| 11 | Spec-driven et OpenDesign | `NON FAIT` | Seul `docs/adr/0017-opendesign-integration.md` existe. Aucun `.unifia/specs/`, aucun schéma de spec, aucun design token, aucun code. |
| 12 | Artifact Studio | `PARTIEL` | `ArtifactStore` 5/5 fournit `create`/`read`/`pending` avec quota, SHA-256 et outbox. Les artefacts sont **adressés par contenu** : deux révisions d'un même document produisent deux ids sans lien. Donc **pas de lignage de versions**, pas de diff sémantique, pas de preview sandboxée, pas de metadata stripping — le cœur de la Phase 12 est `NON FAIT`. |
| 13 | Memory et session intelligence | `PARTIEL` | `MemoryRuntime` 4/4, routes serveur. Provenance, consentement, classification de sensibilité : `NON FAIT`. |
| 14 | Workflow automation | `PARTIEL` | `WorkflowRuntime` + `FileWorkflowStore` 1/1, start/resume/cancel. Les 8 workflows du plan §28 : `NON FAIT`. |
| 15 | Skill Hub et Marketplace | `PASS local` | `SkillHubRegistry` 8/8, manifeste strict, signatures trustées, refus de downgrade, sorties immuables ; routes serveur avec scope. Marketplace distante : `NON FAIT` (et hors périmètre local). |
| 16 | MCP UI Control et Generative UI | `PARTIEL` | Renderer allowlisté 3/3, `McpUiControlBroker` 4/4, routes `/v1/ui/actions` et `/v1/ui/render`. **Transports MCP** : `@unifia/mcp-transport` 32/32. **Consommateur DOM** : `@unifia/generative-ui-dom` 29/29, montage sûr, payloads hostiles couverts. **E2E navigateur réel : `PASS local`** — `GenerativeUiBrowserE2E` 10/10 dans Chromium réel, chaîne render → clic → broker → audit, un clic généré devient une approbation en attente. |
| **Gate C** | Plateforme extensible stabilisée | `NO-GO` | Voir `GATE-C-STATUS-2026-08-03.md`. Bloquants : Phase 11 absente, cœur Phase 12 absent, pas de consommateur DOM, pas de bootstrap serveur, audit externe absent. |
| 17 | Release hardening | `PARTIEL` | Gate de conformance reproductible livré ce jour (8/8). Reliability soak, crash matrix §32 et reproductibilité de build : `NON FAIT`. |
| 18 | Release publique | `BLOQUÉ EXTERNE` | Installers signés, audit externe ciblé computer-use/remote : nécessitent des clés et un auditeur tiers. |

## Ce qui n'est prouvé par aucun test de package

Ces points sont volontairement listés parce qu'une suite verte ne les couvre pas :

1. ~~Aucun processus n'expose le WorkbenchServer.~~ **Clos le 2026-08-04** par `5590c9d`. Le passage aux preuves HTTP réelles a immédiatement révélé trois défauts de production qu'aucun test en mémoire ne pouvait voir : chemin d'erreur mort sur les 17 routes (`return` sans `await` dans `fetch`), contenu de fichier sérialisé en `{"type":"Buffer",...}`, et flux SSE tué par l'idle timeout faute d'octet initial.
2. ~~Aucun consommateur DOM du Generative UI.~~ **Clos le 2026-08-04** par `2783f35` (29/29) puis `637f786` : la preuve en navigateur réel tourne (`GenerativeUiBrowserE2E` 10/10). Chromium réel charge la page sur un vrai socket, monte l'UI décrite par le serveur avec le vrai consommateur, et un clic réel repart en HTTP dans `WorkbenchServer.fetch` jusqu'à l'audit durable — **un clic depuis une UI générée ne s'exécute pas, il devient une approbation en attente**.
3. **Aucun fournisseur MCP externe branché.** Le transport est prouvé contre une paire loopback et des flux injectés, pas contre un serveur MCP réel.
4. **Aucune preuve externe** : pas d'audit tiers, pas de pentest, pas de démo 90 minutes, pas de release signée.

## Prochaine action unique

Voir `NEXT-CARD-2026-08-04.md`.
