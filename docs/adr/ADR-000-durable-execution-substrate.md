<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-000 — Durable Execution Substrate

> **Statut** : PROPOSED (à valider)
> **Date** : 2026-09-01
> **Auteurs** : agent Mavis mvs_56ff19232dc5452082047fce8c11b9c4
> **Décideurs** : Erwan (décision finale)
> **Source** : plan V2.3.1 §34-40, EXECUTION_PROFILE_REQUIREMENTS.md,
> THREAT_MODEL.md, BASELINE.md §5.1, RISK_REGISTER.md (R-014).

## Status

PROPOSED. Bloquant pour M1. Ne peut pas être rendu avant la résolution
de R-013 (suite Automate minimale) — la décision de substrate est
irréversible et elle engage tout M1-M3.

## Context

Unifia Automate est la couche d'exécution durable d'Unifia. Le plan V2.3.1
§1 fixe la règle suprême :

> Un WorkflowRun possède exactement une seule autorité durable.

§2 interdit la double autorité. Le plan §34 liste les candidats substrate :

- Native Unifia declarative kernel
- DBOS (TypeScript, MIT, in-memory + Postgres)
- Restate (TypeScript SDK, BSL/Elastic)
- Temporal (Go core + SDKs, MIT)

Le `packages/workflow-runtime` actuel (91 lignes, mesuré dans
`BASELINE.md §5.1`) est un exécuteur linéaire de capabilities. Il **n'est
pas** un durable execution substrate au sens du plan : pas de timer durable,
pas de canonicalisation, pas d'effet identity, pas de `UNKNOWN_EXTERNAL_STATE`,
pas de fencing. Le finding R-014 du `RISK_REGISTER.md` l'a établi.

## Problem

Quel substrate garantit qu'un `WorkflowRun` :

1. possède **une seule** autorité durable, immutable pendant le run ;
2. survit à un crash de process, de worker, de contrôleur ;
3. supporte un `durable wait` (approval, timer, signal) sans dérive ;
4. expose une API TS pour Bun/Node, alignée stack Unifia ;
5. fonctionne **offline** (cible `local-single-node` du profil
   `EXECUTION_PROFILE_REQUIREMENTS.md §1.1`) ;
6. peut être portable vers Android (`mobile-local-execution` classé
   `FUTURE_COMPATIBILITY_REQUIRED`) ;
7. ne dépend pas d'un service cloud propriétaire ;
8. porte un coût opérationnel acceptable pour un usage local ;
9. ne crée pas de double autorité (plan §2) avec `enterprise` /
   `workbench-orchestrator` / autre ;
10. expose un pipeline d'effet-at-most-once via idempotency identity
    (plan §85, §87) — pas exactly-once générique.

## Requirements

Récapitulatif des `EXECUTION_PROFILE_REQUIREMENTS.md §5` :

| ID | Requirement | Source |
|---|---|---|
| REQ-1 | Offline (local-single-node) | §28 |
| REQ-2 | Self-contained, no external daemon | §28 |
| REQ-3 | No administered cluster, no proprietary cloud | §28 |
| REQ-4 | TS-compatible (Bun/Node stack) | stack Unifia |
| REQ-5 | Android-portable (mobile-local-execution) | §29 |
| REQ-6 | License compatible (MIT ou compatible, soveignty) | projet |
| REQ-7 | Self-hostable | sovereignty |
| REQ-8 | Durable wait, durable approval, crash recovery, backup/restore | §35 |
| REQ-9 | Operational burden acceptable pour local | §35 |
| REQ-10 | Single authority per run, immutable | §1, §2, §43 |
| REQ-11 | Effect identity (idempotency, UNKNOWN_EXTERNAL_STATE) | §85, §87, §88 |
| REQ-12 | Timer durable + scheduler authority | §94, §100 |

## Constraints

| ID | Constraint |
|---|---|
| C-1 | Pas d'introduction de dépendance cloud obligatoire |
| C-2 | Pas de SDK propriétaire verrouillé |
| C-3 | Compatibilité Bun et Node |
| C-4 | Pas d'instrumentation telemetry par défaut (local-first) |
| C-5 | Le runtime actuel (`packages/workflow-runtime`) doit rester
       compilable en attendant la migration, ou être déprécié en
       un seul commit clairement réversible |
| C-6 | Aucun secret ne doit transiter par le substrate en clair (plan §123) |
| C-7 | Aucun chemin réseau obligatoire pour le profile local |

## Options

### Option A — Native Unifia declarative kernel

**Description** : on réécrit `packages/workflow-runtime` en kernel
durable natif, en TypeScript, avec une history en SQLite, un timer en
arbre d'intervalles, et un effect identity (idempotency par `hash(workflowVersionId,
runId, logicalInvocationId, effectSlot)`).

**Preuves en faveur** :
- Contrôle total de la souveraineté (REQ-3, REQ-7).
- Pas de dépendance tierce volatile.
- TS pur → Bun/Node (REQ-3) et Android-via-Bun (REQ-5) possibles.
- Aligné avec la doctrine « first supported desktop platform = local ».

**Preuves en défaveur** :
- Effort d'implémentation élevé (12+ cartes en M1-M3, plan §195-201).
- Substrate engineering est notoirement difficile : timer durable, recovery
  correctness, fencing, restart semantics. DBOS et Restate ont déjà résolu
  ces problèmes.
- Risque de bugs subtils (UNVERIFIED sur la durée).

**Hard eliminators** : aucun. C'est une option **viable mais coûteuse**.

### Option B — DBOS

**Description** : DBOS (TypeScript, MIT) est un framework durable execution
qui transforme les fonctions annotées en steps persistés. Il utilise
Postgres (self-hosted) ou SQLite pour la history. Approche « wrap your
functions, get durable execution for free ».

**Preuves en faveur** :
- TS natif (REQ-3, REQ-4).
- MIT license (REQ-6).
- Pattern de récupération robuste (testé en production).
- Self-hosted Postgres ou SQLite — pas de cloud obligatoire (REQ-3, REQ-7).

**Preuves en défaveur** :
- Dépendance externe : un update DBOS peut casser la compat. À évaluer.
- Postgres n'est pas un daemon Bun. Pour local-first, SQLite seulement.
  DBOS supporte SQLite en preview.
- Pas de garantie sur Android (DBOS cible serveur).
- Modèle « wrap functions » ne couvre pas tous les `node families` du
  plan §57 — il faudrait écrire les nodes Automate par-dessus DBOS.

**Hard eliminators possibles** :
- Si DBOS-SQLite est instable → éliminé.
- Si DBOS n'est pas portable Android → réduit `mobile-local-execution` à
  `UNSUPPORTED`, ce qui contredit `EXECUTION_PROFILE_REQUIREMENTS.md §1.8`.

**Statut** : à qualifier par spike (M0-01).

### Option C — Restate

**Description** : Restate (BSL, changeant à Elastic License) est un
framework durable execution en TS/Java/Go/Rust. Il a un SDK TS qui supporte
Bun/Node. Self-hostable.

**Preuves en faveur** :
- TS natif (REQ-3, REQ-4).
- Self-hostable (REQ-7).
- SDK TS bien maintenu.
- Single authority par invocation (REQ-10).

**Preuves en défaveur** :
- **Licence BSL → Elastic License** : non-MIT. N'est **pas open source**
  selon l'OSI. Contredit REQ-6 et la doctrine de souveraineté Unifia
  (cf. `vault/projects/unifia/AGENTS.md`).
- Risque commercial de licence changeante.
- Pas de garantie Android (SDK serveur).

**Hard eliminators** :
- **Licence non-MIT** → éliminé pour la cible première (REQ-6 violée).

### Option D — Temporal

**Description** : Temporal (MIT, Go core + SDKs polyglottes) est le substrate
durable execution de référence. Le SDK TS est mature.

**Preuves en faveur** :
- MIT license (REQ-6).
- TS SDK (REQ-4).
- Robustesse prouvée (utilisé en production à grande échelle).
- `temporalite` permet d'embarquer Temporal dans un process Node pour
  local-first.
- Self-hostable (REQ-7).
- Single authority par workflow (REQ-10).
- Timer durable, signal, query (REQ-12).
- Effect identity via `workflowId` + `activityId` (REQ-11).

**Preuves en défaveur** :
- `temporalite` est en early stage et marqué « pas production » par
  Temporal eux-mêmes. Pour `local-single-node` self-contained, il faut
  soit `temporalite`, soit un serveur Temporal (REGO/Postgres), qui
  contredit REQ-2 (no external daemon).
- Pas de garantie Android.
- Modèle « workflow as code » ne couvre pas tous les `node families` du
  plan §57.
- Operational burden d'un serveur Temporal (même embedded) est plus
  élevé que natif.

**Hard eliminators possibles** :
- Si `temporalite` reste « not production » → éliminé pour local-first
  self-contained.

**Statut** : à qualifier par spike (M0-01) — confirmer que `temporalite`
est acceptable pour la cible première.

## Evidence

| Source | Contenu | Statut |
|---|---|---|
| `BASELINE.md §5.1` | 91 lignes du `WorkflowRuntime` actuel, sans timer durable ni canonicalisation | MEASURED |
| `RISK_REGISTER.md#R-014` | finding R-014 — workflow-runtime non substrate-grade | MEASURED |
| `EXECUTION_PROFILE_REQUIREMENTS.md §1.1` | contraintes `local-single-node` | MEASURED |
| `THREAT_MODEL.md §1.1` | threats TM-W-01..05 adressés par ce choix | MEASURED |
| `plan V2.3.1 §34-40` | 4 candidats + spike + failure matrix | MEASURED |
| Web (DBOS, Restate, Temporal licenses) | à vérifier au moment de l'ADR | UNVERIFIED — spike requis |
| DBOS-SQLite support | à vérifier | UNVERIFIED — spike requis |
| `temporalite` production status | à vérifier au moment du spike | UNVERIFIED — spike requis |

## Decision

**Option PROPOSED : A — Native Unifia declarative kernel**, sous réserve
du spike M0-01 qui comparera à DBOS et Temporal sur la failure matrix
du plan §38.

**Justification préliminaire** :
- REQ-6 (MIT ou compatible) est éliminatoire pour Restate.
- REQ-2 (no external daemon) est éliminatoire pour Temporal-serveur.
- DBOS et Temporal-temporalite doivent passer un spike avant élimination.
- Le kernel natif évite la dépendance externe et préserve la souveraineté.
- Le coût d'implémentation est élevé, mais M1-M3 sont déjà prévus.

**Conditions du spike M0-01 (plan §37-38)** :
1. Comparer A vs B (DBOS) vs D (Temporal-temporalite).
2. Workflow : `schedule → test HTTP A → durable approval → test HTTP B`.
3. Failure matrix :
   - kill before A
   - kill during A
   - remote A succeeds but local ack lost
   - restart during approval
   - duplicate trigger
   - kill during B
   - restart after completion
4. Mesures : recovery correctness, duplicate effect count, history behavior,
   durable waits, resource usage, operational complexity, packaging,
   local deployment, server deployment, upgrade complexity.

**Critère de décision final** :
- Si A passe le spike sans bug bloquant → A est choisi.
- Si A échoue et B passe → B est choisi, mais REQ-5 (Android) doit être
  ré-évalué : DBOS-SQLite ne couvre pas Android → `mobile-local-execution`
  reste `FUTURE_COMPATIBILITY_REQUIRED` (acceptable).
- Si A et B échouent et D-temporalite passe → D est choisi, à condition
  que `temporalite` soit explicitement marqué production-ready par Temporal.

## Consequences

**Si A est choisi** :
- `packages/workflow-runtime` est réécrit en kernel natif.
- M1 — Durable Core (12 cartes) crée `WorkflowDefinition`/`WorkflowVersion`/
  `WorkflowIR`/canonisation/history authority au-dessus du kernel.
- Effort estimé : élevé, mais sans dépendance externe.
- Toutes les `node families` du plan §57 doivent être implémentées
  (incluant les executors HTTP, MCP, Connector, Browser, etc.).

**Si B (DBOS) est choisi** :
- `packages/workflow-runtime` devient adapter DBOS.
- M1 — Durable Core se concentre sur le contrat observable
  (`WorkflowRun`, `durableAuthorityId`, `WorkflowVersion`) au-dessus de
  DBOS.
- Android `mobile-local-execution` reste `FUTURE_COMPATIBILITY_REQUIRED`
  (non régressé).
- DBOS doit être audité pour conformité MIT.

**Si D (Temporal) est choisi** :
- `packages/workflow-runtime` devient adapter Temporal.
- M1 — Durable Core crée le mapping `WorkflowVersion` → Temporal Workflow.
- Android `mobile-local-execution` reste `FUTURE_COMPATIBILITY_REQUIRED`.
- `temporalite` doit être confirmé production-ready.

**Si tous échouent** : STOP-ARCHITECTURE-CONFLICT, retour à la planche
et nouvelle ADR.

## Trade-offs

| Trade-off | A | B | D |
|---|---|---|---|
| Effort d'implémentation | Très élevé | Moyen | Moyen |
| Souveraineté | Maximale | Haute (MIT) | Haute (MIT) |
| Android (`mobile-local-execution`) | Possible | Non mesuré | Non mesuré |
| Operational burden (local) | Faible | Faible (SQLite) | Moyen (`temporalite` ou serveur) |
| Risque de bugs | Plus élevé | Faible | Faible |
| Vendor lock-in | Aucun | DBOS | Temporal |
| License | MIT | MIT | MIT |

## Rejected alternatives

- **Restate** (Option C) : rejetée pour **licence non-MIT** (BSL → Elastic).
- **Side-step** (ne pas choisir) : rejetée — M1 ne peut pas démarrer
  sans substrate choisi.
- **Multi-substrate** : rejetée — plan §2 interdit la double autorité.

## Security impact

- REQ-10 (single authority, immutable) : garanti par construction.
- REQ-6 (license MIT) : garantit l'absence de dépendance à un vendor
  hostile.
- TM-W-01..05 du `THREAT_MODEL.md §1.1` adressés par le choix de substrate.
- Secret Broker (TM-S-01..03) indépendant du substrate, mais ADR-010
  le branche.

## Migration impact

- Le `WorkflowRuntime` actuel doit être remplacé ou réécrit. Tous ses
  tests (91 lignes + 1 fichier test) doivent être réécrits.
- `workbench-server/src/index.ts` (97 Ko) consomme `WorkflowRuntime` —
  le découpage en sous-modules (C-PRE1-04) doit précéder la migration
  pour limiter le blast radius.
- `automate-surface.tsx` consomme l'API cliente du wire workbench — pas
  d'impact direct.

## Testing strategy

1. **M0-01 spike** (plan §37-38) : failure matrix + 7 scénarios de kill.
2. **M1 tests** (plan §196) :
   - canonicalization vectors
   - determinism
   - restart
   - reconstruction
   - authority uniqueness
   - scope isolation structural tests
   - historical schema read
   - artifact contract tests
   - digest verification
   - crypto envelope migration compatibility contract tests
3. **M3 crash matrix** (plan §201) : avant/après chaque transition critique.

## Rollback / exit strategy

- Le commit du nouveau substrate inclut un feature flag : `legacy: true`
  pour utiliser l'ancien `WorkflowRuntime`.
- Si le spike M0-01 montre un bug bloquant, retour à cette ADR avec
  une Option E (à définir).
- Aucun WorkflowRun GA tant que le spike n'est pas passé.

## Liens

- `plan V2.3.1` §34-40 (candidats, hard eliminators, spike, failure matrix, mesures, output)
- `EXECUTION_PROFILE_REQUIREMENTS.md` §1.1, §5
- `THREAT_MODEL.md` §1.1
- `RISK_REGISTER.md#R-014`
- `AUTOMATE_TRUST_PATH.md` §A.1
- `PACKAGE_MIGRATION_MAP.md` §1.1
- `IMPLEMENTATION_CARD_INDEX.md` (ADR-000, M0-01)
- ADR suivants : ADR-001, 002, 003, 004, 005, 010
