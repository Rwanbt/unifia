<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-000 — Durable Execution Substrate

> **Statut** : **CHANGES_REQUIRED_BEFORE_RATIFICATION** — review du
> 2026-09-02 (Erwan). Le second tour M0-01-BIS a levé les 3 `UNVERIFIED`,
> mais la review a montré que **deux éliminateurs ne sont pas assez
> précisément définis pour prouver que A est réellement l'unique
> survivant**. A est `SURVIVANT_CONDITIONNEL`, pas retenue.
> Deux décisions de politique produit sont ouvertes : voir §*Décisions de
> politique ouvertes*.
> **Date** : 2026-09-01
> **Auteurs** : agent Mavis mvs_56ff19232dc5452082047fce8c11b9c4
> **Décideurs** : Erwan (décision finale)
> **Source** : plan V2.3.1 §34-40, EXECUTION_PROFILE_REQUIREMENTS.md,
> THREAT_MODEL.md, BASELINE.md §5.1, RISK_REGISTER.md (R-014).

## Status

**CHANGES_REQUIRED_BEFORE_RATIFICATION** (2026-09-02, review Erwan).

Le second tour M0-01-BIS a levé les trois `UNVERIFIED`. Mais la review a
établi que **A survit à des règles dont deux ne sont pas assez précisément
définies** pour démontrer qu'elle est l'unique survivante. L'état honnête
des candidats est donc :

| Candidat | Statut |
|---|---|
| **A** Native Unifia | **SURVIVANT_CONDITIONNEL** — pas démontré |
| **B** DBOS TypeScript | **ÉLIMINÉ** pour `local-single-node` (Postgres requis) |
| **B′** DBOS-Go / SQLite | **NOT_QUALIFIED — REQUIRES_PACKAGING_EVALUATION** |
| **C** Restate | **BLOCKED_ON_POLICY** — dépend de l'interprétation de REQ-6 |
| **D** Temporal | **ÉLIMINÉ** pour le profil local de production |

Deux décisions de politique produit doivent être tranchées avant
ratification — elles ne sont écrites ni dans le plan gelé, ni dans
`EXECUTION_PROFILE_REQUIREMENTS.md`, ni dans aucun `AGENTS.md`. Voir
§*Décisions de politique ouvertes*.

> **Défaut de traçabilité, trouvé le 2026-09-02.** Les identifiants
> `REQ-1` … `REQ-12` du tableau *Requirements* ci-dessous **n'existent pas
> dans leur source citée**. `EXECUTION_PROFILE_REQUIREMENTS.md §5` contient
> un tableau de contraintes **non numéroté** ; les `REQ-N` sont une
> numérotation propre à cet ADR, présentée comme sourcée. La ligne réelle
> pour REQ-6 est littéralement `License compatible (MIT) | projet` — elle
> renvoie à une politique projet qui n'est écrite nulle part. C'est
> exactement pourquoi REQ-4 et REQ-6 sont trop faibles pour porter une
> élimination.

> Historique : ce statut était `PROPOSED`, puis `READY_TO_RATIFY`. Le
> premier blocage annoncé (R-013) n'était pas le vrai ; le vrai était un
> critère inapplicable à l'évidence (F-M2-04). Le passage prématuré à
> `READY_TO_RATIFY` est le second : il tenait pour acquis que REQ-4 et
> REQ-6 étaient normatifs.

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
10. expose une exécution **durable at-least-once** avec identité logique
    stable des effets, idempotence quand le provider la supporte,
    réconciliation quand l'état externe est interrogeable, et
    `UNKNOWN_EXTERNAL_STATE` quand le résultat d'un effet ne peut pas être
    établi (plan §85 « NO EXACTLY-ONCE CLAIM », §86, §87, §88).

## Requirements

Récapitulatif des `EXECUTION_PROFILE_REQUIREMENTS.md §5` :

| ID | Requirement | Source |
|---|---|---|
| REQ-1 | Offline (local-single-node) | §28 |
| REQ-2 | Self-contained, no external daemon | §28 |
| REQ-3 | No administered cluster, no proprietary cloud | §28 |
| REQ-4 | **OUVERT — à durcir.** Formulation actuelle « TS-compatible (Bun/Node stack) ». Insuffisante pour éliminer un sidecar empaqueté : « ce n'est pas TypeScript » ne démontre pas une violation d'architecture produit. Voir §*Décisions de politique ouvertes*. | stack Unifia |
| REQ-5 | Android-portable (mobile-local-execution) | §29 |
| REQ-6 | **OUVERT — ambigu.** La source dit littéralement `License compatible (MIT) | projet`. « Compatible MIT » et « OSI-approved obligatoire » ne donnent pas le même verdict sur Restate. Voir §*Décisions de politique ouvertes*. | projet (non écrit) |
| REQ-7 | Self-hostable | sovereignty |
| REQ-8 | Durable wait, durable approval, crash recovery, backup/restore | §35 |
| REQ-9 | Operational burden acceptable pour local | §35 |
| REQ-10 | Single authority per run, immutable | §1, §2, §43 |
| REQ-11 | **Durable at-least-once** + identité logique stable des effets + idempotence quand le provider la supporte + réconciliation quand l'état externe est interrogeable + `UNKNOWN_EXTERNAL_STATE` sinon | §85, §86, §87, §88 |
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

**Description** : Unifia possède sa propre **autorité durable déclarative**.
`packages/workflow-runtime` est réécrit en kernel durable natif, en
TypeScript, conforme aux contrats décidés par les ADR subséquentes.

> **Ce qu'ADR-000 ne décide PAS.** Le storage de la history, l'indexation
> des timers, la sérialisation canonique et l'implémentation des effets
> **ne sont pas tranchés ici**. Ils appartiennent respectivement à ADR-004
> (history/autorité), ADR-022 et ADR-008 (timer, scheduler, timeouts),
> ADR-001 (canonicalisation) et ADR-007 (effets). La version initiale de
> cet ADR annonçait « history SQLite, timer en arbre d'intervalles, effect
> identity par hash » — une phrase d'ADR-000 ne doit pas devenir
> accidentellement plus normative qu'ADR-008.

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
| DBOS Transact TS license | **MIT**, « Copyright (c) 2023 DBOS, Inc. » | **VERIFIED** 2026-09-02 — [`LICENSE`](https://github.com/dbos-inc/dbos-transact-ts/blob/main/LICENSE) |
| Restate license | **Business Source License 1.1** (Restate Software, Inc. / Restate GmbH). Non-OSI. | **VERIFIED** 2026-09-02 — [`LICENSE`](https://raw.githubusercontent.com/restatedev/restate/main/LICENSE) |
| DBOS-SQLite support | **Absent du SDK TypeScript.** « DBOS requires a Postgres database ». SQLite existe côté **Go seulement** (Golang v0.17, juin 2026). Seules voies TS : Postgres installé ou `npx dbos postgres start` (Docker). | **VERIFIED** 2026-09-02 — [docs TS](https://docs.dbos.dev/typescript/integrating-dbos), [quickstart](https://docs.dbos.dev/quickstart), [blog juin 2026](https://www.dbos.dev/blog/new-in-dbos-june-2026) |
| `temporalite` production status | **Archivé** (`temporalio/temporalite-archived`). Son remplaçant, le dev server du CLI, « skips certain HTTP security checks », est **in-memory par défaut**, et la doc renvoie explicitement au self-hosted guide ou à Temporal Cloud pour la production. | **VERIFIED** 2026-09-02 — [dev server](https://docs.temporal.io/develop/run-a-development-server), [dépôt archivé](https://github.com/temporalio/temporalite-archived) |

Détail complet du second tour : `spikes/M0-01-BIS-EVIDENCE.md`.

### RÉSOLU — second tour de qualification (2026-09-02)

L'écart décrit ci-dessous a été traité par le second tour M0-01-BIS. Les
trois `UNVERIFIED` sont levées (voir tableau *Evidence*), et le résultat est
**décisif sans spike comparatif** : les éliminateurs durs tombent en amont de
la failure matrix, ce qui est exactement la structure du critère.

| Option | Éliminateur | Verdict cible première |
|---|---|---|
| **A** Native kernel | — | **SURVIVANT_CONDITIONNEL** |
| **B** DBOS TypeScript | REQ-2 : le SDK **TypeScript** exige Postgres (installé ou Docker) et Node 20+. SQLite est **Go-only**. | **ÉLIMINÉ** — éliminateur solide |
| **B′** DBOS-Go | REQ-4, dans sa formulation actuelle, ne suffit pas | **NOT_QUALIFIED — REQUIRES_PACKAGING_EVALUATION** |
| **C** Restate | REQ-6, dont l'interprétation n'est pas fixée | **BLOCKED_ON_POLICY** |
| **D** Temporal | REQ-2 : la **topologie de production** exige un Temporal Service et une base administrée séparément | **ÉLIMINÉ** — raison reformulée |

L'élimination de **B (DBOS TypeScript)** est **plus forte** que ce que cet
ADR anticipait : il écrivait « si DBOS-SQLite est *instable* → éliminé ».
Ce n'est pas une question de maturité — côté TypeScript, DBOS-SQLite
**n'existe pas**. Cet éliminateur tient.

**L'élimination de D (Temporal) est reformulée.** La première rédaction
s'appuyait sur le dev server et affirmait que « la documentation renvoie à
Temporal Cloud pour la production » — c'est **inexact** : Temporal
documente explicitement le self-hosting en production. Le raisonnement
correct, et plus robuste, est celui-ci : Temporal est excellent
techniquement, mais sa **topologie de production** exige un véritable
Temporal Service adossé à PostgreSQL, MySQL ou Cassandra — une
infrastructure durable administrée séparément. Cela suffit à violer REQ-2
pour la cible `local-single-node`, sans avoir à invoquer le dev server ni
Temporal Cloud.

**Les éliminations de B′ et C sont retirées** (review du 2026-09-02) :

- **B′ (DBOS-Go)** — « ce n'est pas TypeScript » ne démontre pas une
  violation d'architecture produit. Un sidecar entièrement empaqueté et
  piloté par Unifia peut exposer une API TS par IPC sans devenir une
  infrastructure administrée séparément. Statut ramené à
  `NOT_QUALIFIED — REQUIRES_PACKAGING_EVALUATION`.
- **C (Restate)** — le constat factuel tient (BSL 1.1, non-OSI), mais deux
  vérifications changent la portée de l'éliminateur. Voir ci-dessous.

### Restate — ce que la vérification a réellement montré

| Fait | Vérifié |
|---|---|
| Licence serveur | **Business Source License 1.1**, non-OSI |
| **Additional Use Grant** | « You may make use of the Licensed Work, provided that you may not use the Licensed Work for a **Public Restate Platform Service** ». Il **autorise explicitement** une plateforme de workflow publique posant une abstraction (GUI, DSL ou API) au-dessus de Restate, tant que les utilisateurs finaux n'accèdent pas directement aux API Restate pour enregistrer leurs propres services. **C'est le modèle d'Unifia Automate.** |
| **Change License** | **Apache License 2.0**, 4 ans après release |
| Topologie | **Binaire unique auto-contenu, aucune dépendance externe** ; journal et state dans un **RocksDB embarqué**. Du laptop au cloud. |
| REQ-2 / REQ-4 / REQ-7 | **satisfaits** (self-contained, SDK TypeScript, self-hostable) |

Autrement dit : Restate est **juridiquement utilisable** par Unifia et
**techniquement conforme** au profil local. Son élimination ne peut donc
reposer que sur une **politique de licence**, pas sur une incompatibilité.
Si REQ-6 signifie « OSI-approved obligatoire », Restate est correctement
éliminé — mais il faut l'écrire. Sinon Restate revient dans la
qualification, et devient probablement le concurrent externe le plus
sérieux de A.

**Critère de décision réécrit, honnêtement.** L'ancienne formulation (« si A
passe le spike sans bug bloquant → A est choisi ») supposait une comparaison
qui n'a jamais eu lieu et n'a désormais plus lieu d'être. La formulation
exacte de ce qui s'est produit est :

> **A est retenue par élimination, pas par démonstration.** Les trois autres
> options tombent sur des éliminateurs durs mesurés à leurs sources
> primaires. A n'a été validée par aucun spike — le kernel natif n'existe pas
> encore, donc rien ne pouvait le mesurer. Le premier tour M0-01 a mesuré le
> `workflow-runtime` *legacy*, que A propose précisément de remplacer.

**Portée des éliminations.** Elles reposent sur REQ-2 (pas de démon externe),
exigence du profil `local-single-node`. Sur un futur profil serveur,
DBOS-Postgres et Temporal-serveur redeviennent techniquement valides — mais
le plan §1-§2 interdit deux autorités durables : adopter A engage le produit,
sauf ADR de migration explicite.

**Coût inchangé.** Sept ADR (001, 002, 004, 007, 008, 020, 022) portent
directement la **sémantique du kernel** et doivent être rendus avant qu'un
kernel natif soit utilisable. Ce n'est **pas** la totalité de la gate M1 :
la **M1 Final Gate du plan §197 reste autoritaire** et exige davantage
(ADR-003, 005, 010, 019, 023, 024, 016 et 021 conditionnels, plus PRE-0 GO,
PRE-1 COMPLETE, Threat Model V1, profil d'exécution FROZEN, et zéro finding
Critical ou High). Et ce que M0-01 a établi
reste vrai quel que soit le choix : le runtime actuel n'est pas
substrate-grade et perd des données silencieusement sur trigger dupliqué. A
signifie **réécrire**, pas conserver.

**Niveau de preuve.** Vérification documentaire aux sources primaires
(fichiers `LICENSE`, doc officielle, notes de release), non reproduite par
commande. C'est le bon niveau pour des éliminateurs de license et de
topologie de déploiement ; ce ne le serait pas pour une propriété de
correction runtime.

---

### Écart entre le critère de décision et l'évidence disponible (2026-09-02, historique)

Le spike M0-01 a été exécuté et son évidence est épinglée
(`spikes/M0-01-EVIDENCE.md`, 4 PASS / 2 PARTIAL / 1 FAIL / 7 MISSING).
**Il ne permet pas d'appliquer le critère de décision ci-dessous tel qu'il
est écrit**, pour deux raisons mesurées :

1. **Le spike n'a pas mesuré l'option A.** Il a mesuré le
   `packages/workflow-runtime` *existant* — l'exécuteur linéaire de 91
   lignes. Ce n'est pas « le kernel natif de l'option A », c'est le legacy
   que l'option A propose de remplacer. Son unique FAIL (trigger dupliqué
   qui écrase l'état sans avertir) est un bug de ce legacy, pas une
   propriété d'un kernel natif à écrire. Lire le critère « si A passe le
   spike sans bug bloquant → A est choisi » au pied de la lettre ferait
   échouer A sur un test qui ne portait pas sur A.
2. **Ni B ni D n'ont été exercés.** `grep -ci 'dbos\|temporal\|restate'
   docs/automation-v2/spikes/m0-01-substrate.ts` → **0**, sur 265 lignes.
   Le spike lui-même le déclare en §4 (« les deux nécessitent un setup
   externe non disponible dans cette session »). La comparaison sur la
   failure matrix §38, qui est la substance du critère, n'a pas eu lieu.

Les trois lignes `UNVERIFIED` du tableau *Evidence* ci-dessus — license
DBOS, support DBOS-SQLite, statut production de `temporalite` — sont
toujours `UNVERIFIED`. Or deux d'entre elles sont des **éliminateurs durs**
dans le critère.

**Conséquence** : la décision reste ouverte, mais elle ne l'est plus pour
la raison écrite dans le statut (« attend le spike »). Le spike a eu lieu.
Ce qui manque est un second tour de qualification, portant sur B et D, ou
une décision assumée sur A **sans** comparaison — auquel cas le critère
de décision doit être réécrit pour dire cela honnêtement, plutôt que
d'invoquer une comparaison qui n'a pas été faite.

Ce qui est établi sans ambiguïté par M0-01, et qui ne dépend d'aucune
option : le runtime actuel n'est pas substrate-grade (R-014 confirmé
empiriquement), et il porte un bug de perte de données silencieuse sur
trigger dupliqué.

## Décisions de politique ouvertes

Deux questions **bloquent la ratification**. Ni le plan gelé, ni
`EXECUTION_PROFILE_REQUIREMENTS.md`, ni aucun `AGENTS.md` du dépôt ou du
vault ne les tranchent — vérifié le 2026-09-02. Ce sont des décisions de
politique produit, pas des questions d'ingénierie.

### P-1 — Que signifie REQ-6 exactement ?

La source dit `License compatible (MIT) | projet`. Deux lectures, deux
verdicts opposés :

- **Lecture stricte (OSI-only)** — *« le substrate distribué avec Unifia
  doit être sous une licence OSI-approved, acceptable pour redistribution,
  modification et intégration durable ; une licence source-available BSL
  est exclue même lorsqu'un Additional Use Grant autorise techniquement
  l'usage Unifia. »*
  → **Restate reste éliminé**, proprement et de façon reproductible.
- **Lecture large (compatibilité juridique)** — le substrate doit être
  juridiquement utilisable par Unifia.
  → **Restate revient dans la course**, son grant couvrant explicitement le
  modèle Automate.

### P-2 — REQ-4 doit-il devenir une politique de runtime ?

Formulation proposée : *« le premier profil `local-single-node` ne peut
introduire aucun nouveau runtime système obligatoire ni sidecar écrit dans
un langage absent de la distribution Unifia actuelle, sauf preuve que son
packaging, ses mises à jour, son IPC, sa signature, son lifecycle, son
cross-platform et sa portabilité mobile future sont acceptables. »*

- **Adoptée** → **B′ (DBOS-Go) est proprement éliminé**.
- **Non adoptée** → B′ reste `NOT_QUALIFIED — REQUIRES_PACKAGING_EVALUATION`
  et doit être qualifié avant toute ratification de A.

---

## Decision

**Option pressentie : A — Native Unifia declarative kernel.**
**Statut : CHANGES_REQUIRED_BEFORE_RATIFICATION.**

A est le **survivant conditionnel** : elle survit à des règles dont deux
(REQ-4, REQ-6) ne sont pas encore assez précisément définies pour prouver
qu'elle est réellement l'unique survivante. Tant que P-1 et P-2 ne sont pas
tranchées, écrire « A est retenue » serait une **préférence déguisée en
sélection**.

**Si P-1 = stricte et P-2 = adoptée**, alors la sélection devient
reproductible et A est ratifiable :

| Option | Éliminateur | Règle |
|---|---|---|
| **B** DBOS TypeScript | Exige Postgres (installé ou Docker) + Node 20+. SQLite est **Go-only**. | REQ-2 |
| **B′** DBOS-Go | Nouveau runtime Go obligatoire dans le premier profil. | REQ-4 durcie (P-2) |
| **C** Restate | BSL 1.1 non-OSI, malgré un Additional Use Grant qui couvre le modèle Unifia. | REQ-6 stricte (P-1) |
| **D** Temporal | Topologie de production : Temporal Service + base administrée séparément. | REQ-2 |

**Même dans ce cas, la formulation exacte compte :**

> **A serait retenue par élimination, pas par démonstration.**

Le kernel natif n'existe pas encore, donc rien ne pouvait le mesurer. Le
tour M0-01 a mesuré le `packages/workflow-runtime` *legacy* — précisément
ce que A propose de remplacer. Il ne faut pas lire ce choix comme « A a
gagné une comparaison ». C'est ce qui rend **M0 — Substrate Proof**
non-négociable (voir *Rollback / exit strategy*).

**Le spike comparatif du plan §38 n'a pas été exécuté, et ne le sera pas.**
On ne compare pas des options déjà éliminées : les éliminateurs durs tombent
**en amont** de la failure matrix, ce qui est la structure même du critère.
Les conditions du spike restent consignées ci-dessous à titre historique.

**Ce que ratifier A engage :**

1. **Réécrire**, pas conserver. Le runtime actuel n'est pas substrate-grade
   (R-014, confirmé empiriquement) et perd des données silencieusement sur
   trigger dupliqué. Ce constat est indépendant du choix.
2. **Sept ADR de sémantique kernel** (001, 002, 004, 007, 008, 020, 022)
   doivent être rendus avant qu'un kernel natif soit utilisable — mais ils
   ne constituent **pas** la gate M1. La **M1 Final Gate du plan §197**
   reste autoritaire et en exige davantage.
3. **Substrate engineering est difficile** — timer durable, recovery
   correctness, fencing, restart semantics. DBOS et Temporal ont déjà résolu
   ces problèmes ; ici on les résout soi-même. C'est le coût assumé de la
   souveraineté et de la contrainte `local-single-node`.
4. **Portée des éliminations** : elles reposent sur REQ-2, exigence du profil
   `local-single-node`. Sur un futur profil serveur, DBOS-Postgres et
   Temporal-serveur redeviennent techniquement valides — mais le plan §1-§2
   interdit deux autorités durables, donc y basculer demanderait un ADR de
   migration explicite.
5. **Niveau de preuve** : vérification documentaire aux sources primaires
   (fichiers `LICENSE`, doc officielle, notes de release), non reproduite par
   commande. C'est le bon niveau pour des éliminateurs de license et de
   topologie de déploiement ; ce ne le serait pas pour une propriété de
   correction runtime.
6. **Réversibilité — graduée, pas nulle.** Une ratification n'est pas un
   point de non-retour immédiat :

   | Étape | Réversibilité |
   |---|---|
   | Après ratification, avant M0 | **Réelle** — M0 existe pour invalider le choix |
   | Après M0 réussi, pendant M1 | **Très faible** — les contrats se figent |
   | Après le premier `WorkflowRun` GA | **Très coûteuse** — history durable et compatibilité de format en jeu |

   > La rédaction précédente parlait d'un engagement « irréversible » sans
   > nuance. C'est faux avant M0, et cela masquait précisément le rôle de
   > M0 comme filet.

<details>
<summary><strong>Historique — critère et conditions de spike d'avant le second tour</strong></summary>

Cette formulation supposait une comparaison qui n'a jamais eu lieu et n'a
plus lieu d'être. Conservée pour la traçabilité.

**Justification préliminaire (2026-09-01)** :
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

**Critère de décision final (obsolète)** :
- Si A passe le spike sans bug bloquant → A est choisi.
- Si A échoue et B passe → B est choisi, mais REQ-5 (Android) doit être
  ré-évalué.
- Si A et B échouent et D-temporalite passe → D est choisi, à condition
  que `temporalite` soit explicitement marqué production-ready.

</details>

## Consequences

**Si A est choisi** :
- `packages/workflow-runtime` est réécrit en kernel natif.
- M1 — Durable Core (12 cartes) crée `WorkflowDefinition`/`WorkflowVersion`/
  `WorkflowIR`/canonisation/history authority au-dessus du kernel.
- Effort estimé : élevé, mais sans dépendance externe.
- Le kernel fournit les **primitives et le contrat executor** permettant les
  `node families` du plan §57. Il **n'impose pas** qu'elles arrivent toutes
  en même temps : chaque famille est implémentée et certifiée par son track,
  selon le modèle `Capability Profile × Execution Profile × Platform`
  (plan §186-§189). La cible première est `Automate Core ×
  local-single-node × Windows` — un **profil complet à surface réduite**
  (§189 : « Pas MVP »), pas l'intégralité de Browser, AI, Desktop et des
  connectors.

  > La version initiale disait « Toutes les `node families` du plan §57
  > doivent être implémentées, executors HTTP, MCP, Connector et Browser
  > compris ». Cette phrase annulait indirectement la décision de Local GA
  > à surface réduite du plan gelé. Retirée.

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

Tableau corrigé après le second tour. Les colonnes B et D sont conservées
parce qu'elles redeviendraient pertinentes sur un profil serveur — mais pour
la cible première, elles sont éliminées et le tableau le dit.

| Trade-off | A | B (DBOS) | D (Temporal) |
|---|---|---|---|
| **Verdict cible première** | **RETENUE** | ÉLIMINÉ (REQ-2) | ÉLIMINÉ (REQ-2) |
| Effort d'implémentation | Très élevé | Moyen | Moyen |
| Souveraineté | Maximale | Haute (MIT) | Haute (MIT) |
| Android (`mobile-local-execution`) | Possible | Non mesuré | Non mesuré |
| Operational burden (local) | Faible | **Postgres requis en TS** (installé ou Docker) | **Serveur externe** ; dev server non-production |
| Risque de bugs | Plus élevé | Faible | Faible |
| Vendor lock-in | Aucun | DBOS | Temporal |
| License | MIT (code maison) | **MIT** (vérifié) | MIT |

La ligne « Operational burden » corrige une erreur de la version initiale,
qui portait « Faible (SQLite) » pour DBOS et « Moyen (`temporalite` ou
serveur) » pour Temporal. Les deux reposaient sur des hypothèses fausses :
DBOS-SQLite n'existe pas en TypeScript, et `temporalite` est archivé.

## Rejected alternatives

Toutes vérifiées aux sources primaires le 2026-09-02 (M0-01-BIS), sauf
mention contraire.

- **DBOS TypeScript** (Option B) : **rejetée** pour **REQ-2** — le SDK
  TypeScript exige Postgres, installé ou dans Docker, plus Node 20+. Rejet
  **plus fort** que prévu : l'ADR anticipait « si DBOS-SQLite est
  *instable* → éliminé », mais en TypeScript DBOS-SQLite **n'existe pas**.
  Redeviendrait candidat sur un profil serveur.
- **Temporal** (Option D) : **rejetée** pour **REQ-2** — la topologie de
  production exige un Temporal Service adossé à PostgreSQL, MySQL ou
  Cassandra, administré séparément. Redeviendrait candidat sur un profil
  serveur. *(Motif reformulé : la première rédaction s'appuyait à tort sur
  le dev server et sur Temporal Cloud ; Temporal documente bel et bien le
  self-hosting en production.)*
- **Side-step** (ne pas choisir) : rejetée — M1 ne peut pas démarrer
  sans substrate choisi.
- **Multi-substrate** : rejetée — plan §2 interdit la double autorité.

**Non rejetées à ce stade** — leur sort dépend de P-1 et P-2 :

- **Restate** (Option C) : `BLOCKED_ON_POLICY`. BSL 1.1 non-OSI, lue au
  fichier `LICENSE` ; mais son Additional Use Grant couvre explicitement le
  modèle Unifia, sa Change License est Apache 2.0 à 4 ans, et sa topologie
  binaire-unique/RocksDB-embarqué satisfait REQ-2. Rejetable sur **P-1
  stricte** uniquement.
- **DBOS-Go** (Option B′, apparue pendant le second tour) :
  `NOT_QUALIFIED — REQUIRES_PACKAGING_EVALUATION`. Elle a SQLite (Golang
  v0.17, juin 2026). Rejetable sur **P-2 adoptée** uniquement — « ce n'est
  pas TypeScript » ne suffit pas.
## Security impact

- REQ-10 (single authority, immutable) : garanti par construction.
- REQ-6 (licence) : une licence libre améliore l'**indépendance**, le
  **droit de fork** et la **souveraineté**. Elle ne garantit **rien** sur le
  comportement futur d'un fournisseur.

  > La rédaction précédente affirmait que la licence MIT « garantit
  > l'absence de dépendance à un vendor hostile ». C'est un abus : une
  > licence encadre des droits, pas des comportements. Retiré.
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
- **Le filet immédiat est M0 — Substrate Proof (plan §194), pas M1.** Le
  plan gelé prévoit déjà cette étape : « Non-release. **Utilise substrate
  choisi.** » Workflow `schedule → HTTP test A → durable approval → HTTP
  test B`, prouvant `restart`, `durable wait`, `approval persistence`,
  `effect uncertainty`, `history mapping`, `timers`, `authority uniqueness`
  — auxquels s'ajoutent, pour cet ADR, le **trigger dupliqué** et la
  **perte d'acquittement local après succès distant**.
- **L'ordre correct est donc** : qualification documentaire → ratification →
  **M0 Native proof** → ADR/contracts → M1 gate → M1. Un échec fondamental
  en M0 doit **rouvrir ADR-000 avant** d'investir massivement dans M1.

  > La rédaction précédente disait que « les gates M1 et la crash matrix M3
  > portent seules la charge de preuve ». C'était **trop tardif** : elle
  > sautait M0, qui existe précisément pour éprouver le substrate choisi
  > avant l'investissement M1.

- Un échec bloquant en M0 ramène à cet ADR avec une Option E à définir — et
  rouvre P-1/P-2, puisque B′ et C ne sont pas éliminés sur le fond.
- Aucun WorkflowRun GA tant que les gates M1 (plan §196) ne sont pas vertes.
- Le repli `legacy: true` n'est **pas** une position tenable : le runtime
  actuel perd des données silencieusement sur trigger dupliqué (M0-01,
  scénario 5). C'est un filet de compilation, pas un mode d'exploitation.

## Liens

- `plan V2.3.1` §34-40 (candidats, hard eliminators, spike, failure matrix, mesures, output)
- `EXECUTION_PROFILE_REQUIREMENTS.md` §1.1, §5
- `THREAT_MODEL.md` §1.1
- `RISK_REGISTER.md#R-014`
- `AUTOMATE_TRUST_PATH.md` §A.1
- `PACKAGE_MIGRATION_MAP.md` §1.1
- `IMPLEMENTATION_CARD_INDEX.md` (ADR-000, M0-01)
- ADR suivants : ADR-001, 002, 003, 004, 005, 010
