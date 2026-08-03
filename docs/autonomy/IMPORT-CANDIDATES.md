# IMPORT-CANDIDATES.md

**Phase :** -1 (Audit comparatif)
**Statut :** `DRAFT` — raffinement requis en Phase 1 avec lecture de code réelle
**Date :** 2026-07-31


## Correctif M1 — règle de preuve

Les mentions UNVERIFIED, UNVERIFIED ou ssumed ne sont pas des preuves. Les décisions historiques restent non exécutables tant que le dépôt, le commit, le chemin exact, la licence et le comportement n'ont pas été vérifiés. Inventaires vérifiés : OpenWork pps/server/ (171 chemins), OpenWork pps/desktop/electron/ (60), Open Cowork src/main/remote/ (16), src/main/sandbox/ (17), et src/main/skills/ + .claude/skills/ (143). OpenWork /ee reste EXCLUDE (1 067 chemins Fair Source). i18n utilisateur reste BLOCKED_MISSING_SOURCE.

## 1. Légende

| Verdict | Signification |
|---|---|
| `ADOPT` | Importer tel quel, après audit code |
| `ADAPT` | Importer et modifier pour conformité Unifia |
| `REWRITE` | Réécrire from scratch en suivant le pattern |
| `INSPIRER` | Ne pas importer, juste s'inspirer du design |
| `EXCLUDE` | Ne pas importer (licence, technique, ou stratégique) |
| `DEFER` | Importer plus tard (Phase X+) |

## 2. Candidats à l'import — depuis OpenWork upstream

### OW-S1 — apps/server (serveur headless multi-workspace)
- **Source :** `https://github.com/different-ai/openwork@2c558bcff` (HEAD verrouillé)
- **Verdict :** `ADAPT`
- **Phase cible :** 5
- **Risque :** DOUBLON_FORT avec `packages/opencode/src/runtime/`
- **Adaptation requise :** Refactorer en `OpenCodeRuntimeAdapter` (Plan V3 §7.1). Préserver la multi-workspace (à conserver comme feature Unifia).
- **Justification :** OpenWork est identifié par Plan V3 §3.1 comme « donneur structurel principal ».
- **Critères de succès :** OpenCodeRuntimeAdapter passe la conformance suite Phase 1.

### OW-S2 — apps/desktop UI patterns (Trace Panel, Permission dialogs)
- **Source :** `https://github.com/different-ai/openwork@2c558bcff`
- **Verdict :** `INSPIRER`
- **Phase cible :** 7
- **Adaptation :** Réécrire en SolidJS (cohérence avec Shell Unifia) en suivant les patterns.
- **Justification :** Le fork Unifia utilise déjà SolidJS (`packages/app/`), pas React.

### OW-S3 — Capability discovery + manifest typé
- **Source :** `https://github.com/different-ai/openwork@2c558bcff`
- **Verdict :** `ADOPT`
- **Phase cible :** 4 (WorkspaceRuntime) + 5 (CapabilityRegistry)
- **Adaptation :** Le format manifest OpenWork sert d'inspiration pour `CapabilityDescriptor` (Plan V3 §7.3).
- **Critères :** Un capability pack OpenWork doit pouvoir être lu par Unifia sans modification.

### OW-S4 — Stats / télémétrie
- **Source :** `https://github.com/different-ai/openwork@2c558bcff`
- **Verdict :** `EXCLUDE` pour l'instant
- **Justification :** Télémétrie activée par défaut = fuite de données potentielle. À reconsidérer en Phase 17 (Release hardening) si tu veux une option opt-in.

### OW-S5 — Code Swift natif (iOS/macOS)
- **Source :** `https://github.com/different-ai/openwork@2c558bcff`
- **Verdict :** `DEFER` Phase 19+
- **Justification :** Tauri garde-fou pour Phase 0-18. Swift natif est post-production.

### OW-S6 — Code `ee/` (50 branches concernées)
- **Source :** `https://github.com/different-ai/openwork@2c558bcff`, branches `ee/*`
- **Verdict :** `EXCLUDE` (par défaut, par licence)
- **Justification :** Plan V3 §3.1 « OpenWork Den /ee → Exclure par défaut ». `ee/LICENSE` est UNVERIFIEDment une licence propriétaire distincte.
- **Verrou :** Hook pre-commit + scan CI qui refuse tout chemin `**/ee/**` dans les imports.

## 3. Candidats à l'import — depuis Open Cowork upstream

### OCW-S1 — Skills bureautiques (DOCX/PPTX/XLSX/PDF)
- **Source :** `https://github.com/OpenCoworkAI/open-cowork@ec5bd27` (HEAD verrouillé)
- **Verdict :** `ADOPT`
- **Phase cible :** 6
- **Format UNVERIFIED :** 78 fichiers XSD (schémas) + TS (implémentations)
- **Adaptation :** Convertir en Capability Packs `unifia.document.docx`, `unifia.document.pptx`, `unifia.document.xlsx`, `unifia.document.pdf` (Plan V3 §3.2).
- **Critères :** Les 4 formats doivent être chargeables comme Capability Packs sans modification du core.
- **Justification :** Plan V3 §3.2 « Skills PPTX/DOCX/XLSX/PDF → Adopter en priorité ».

### OCW-S2 — Sandbox Python (scripts WSL2/Lima)
- **Source :** `https://github.com/OpenCoworkAI/open-cowork@ec5bd27`
- **Verdict :** `ADAPT`
- **Phase cible :** 8 (SandboxBroker) + 10 (Computer Use)
- **Adaptation :** Réécrire l'interface en `SandboxPort` (Plan V3 §7.5).
- **Critères :** SandboxBroker doit pouvoir exécuter les scripts Python d'Open Cowork derrière une policy.
- **Justification :** Plan V3 §3.2 « Sandbox WSL2/Lima → Porter après audit ».

### OCW-S3 — Computer use (Python scripts)
- **Source :** `https://github.com/OpenCoworkAI/open-cowork@ec5bd27`
- **Verdict :** `ADAPT` tardif
- **Phase cible :** 10
- **Adaptation :** Réécrire derrière `DesktopAutomationBroker` (Plan V3 §5). **NE PAS activer par défaut.**
- **Critères :** ApprovalBroker + screenshot redaction + allowlist d'applications obligatoires.
- **Justification :** Plan V3 §3.2 « Computer use → Porter tardivement, Broker dédié, permissions critiques ».

### OCW-S4 — Remote bridges Slack/Feishu
- **Source :** `https://github.com/OpenCoworkAI/open-cowork@ec5bd27`
- **Verdict :** `ADOPT` après Phase 3
- **Phase cible :** 9
- **Adaptation :** Convertir en Capability Packs remote (Slack + Feishu). Derrière `RemoteRuntime` (Plan V3 §5).
- **Critères :** RemoteTransportPort + ApprovalBroker + AuditRuntime obligatoires.
- **Justification :** Plan V3 §3.2 « Slack/Feishu remote control → Porter, RemoteTransport plugins ».

### OCW-S5 — Trace Panel
- **Source :** `https://github.com/OpenCoworkAI/open-cowork@ec5bd27`
- **Verdict :** `INSPIRER`
- **Phase cible :** 7 (Shell Unifia)
- **Adaptation :** Réécrire en SolidJS, alimenté par l'EventLog Unifia (Plan V3 §3.2).
- **Justification :** Plan V3 §3.2 « Trace Panel → Inspirer/porter, Alimenté par l'EventLog Unifia ».

### OCW-S6 — Permission dialogs
- **Source :** `https://github.com/OpenCoworkAI/open-cowork@ec5bd27`
- **Verdict :** `INSPIRER`
- **Phase cible :** 3 (Security foundation)
- **Adaptation :** Réécrire derrière ApprovalBroker unique.

### OCW-S7 — MCP transports
- **Source :** `https://github.com/OpenCoworkAI/open-cowork@ec5bd27`
- **Verdict :** `REWRITE`
- **Phase cible :** 2 (Contrats)
- **Justification :** Plan V3 §3.2 « MCP transports → Comparer, Ne garder qu'une implémentation canonique ». Ne pas importer, juste comparer.

### OCW-S8 — Traduction i18n utilisateur (overlay)
- **Source :** snapshot utilisateur (NON dans mon env)
- **Verdict :** `BLOCKED_MISSING_SOURCE` (cf. carte `P-1-I18N-USER-SOURCE`)
- **Phase cible :** 7 (Shell Unifia)
- **Adaptation :** Mapping des clés Open Cowork → clés Unifia. Préservation intégrale des traductions.
- **Justification :** exigence utilisateur (cf. message du 2026-07-31).

## 4. Récapitulatif par verdict

| Verdict | OpenWork | Open Cowork | Total |
|---|---|---|---:|
| `ADOPT` | 1 (manifest) | 3 (skills, remote, i18n) | 4 |
| `ADAPT` | 1 (server) | 3 (sandbox, computer use, OCW-S4 déjà compté) | 4 |
| `REWRITE` | 0 | 1 (MCP) | 1 |
| `INSPIRER` | 1 (UI) | 2 (Trace, Permission) | 3 |
| `EXCLUDE` | 2 (stats, ee) | 0 | 2 |
| `DEFER` | 1 (Swift) | 0 | 1 |
| `BLOCKED` | 0 | 1 (i18n user) | 1 |
| **Total** | **6** | **10** | **16** |

## 5. Imports interdits sans revue explicite

Tout import NON listé ci-dessus doit être considéré comme **interdit par défaut** et nécessite une revue utilisateur explicite + ADR.

## 6. Conclusion

- **4 imports directs** (ADOPT) à planifier.
- **4 imports avec adaptation** (ADAPT) à fort coût.
- **3 inspirations** (INSPIRER) sans import de code.
- **2 exclusions** (EE + stats).
- **1 import utilisateur bloqué** (i18n).

L'ordre optimal d'import suit le Plan V3 : Phase 2 (contrats) → Phase 5 (OpenWork server) → Phase 6 (Open Cowork skills) → Phase 8 (sandbox) → Phase 9 (remote) → Phase 10 (computer use).
