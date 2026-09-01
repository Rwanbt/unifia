<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# M0-01-BIS EVIDENCE — second tour de qualification substrate (ADR-000)

> Statut : **EVIDENCE_PINNED** — les 3 lignes `UNVERIFIED` d'ADR-000 sont levées
> Date : 2026-09-02
> Motif : finding **F-M2-04** — le premier tour (M0-01) n'a mesuré ni B ni D,
> et a mesuré le `workflow-runtime` legacy au lieu de l'option A.
> Méthode : vérification documentaire aux sources primaires (fichiers
> `LICENSE`, documentation officielle, notes de release).

## 0. Ce que ce tour devait lever

ADR-000 portait trois lignes `UNVERIFIED` dans son tableau *Evidence*, dont
**deux sont des éliminateurs durs** dans son propre critère de décision :

| # | Question | Statut avant |
|---|---|---|
| U-1 | License DBOS (MIT ?) | UNVERIFIED |
| U-2 | Support DBOS-SQLite (REQ-2 : pas de démon externe) | UNVERIFIED |
| U-3 | `temporalite` production-ready ? | UNVERIFIED |

S'y ajoute la license Restate, qu'ADR-000 donnait comme « BSL → Elastic »
sans l'avoir lue.

## 1. Résultats mesurés

| # | Fait établi | Source primaire | Date de lecture |
|---|---|---|---|
| U-1 | **DBOS Transact TS est sous MIT License**, « Copyright (c) 2023 DBOS, Inc. » | [`dbos-transact-ts/LICENSE`](https://github.com/dbos-inc/dbos-transact-ts/blob/main/LICENSE) | 2026-09-02 |
| U-2 | **Le SDK TypeScript de DBOS n'a pas SQLite.** La doc dit littéralement « DBOS requires a Postgres database ». Le README : « durable workflows built on top of Postgres ». Aucune mention de SQLite. | [docs.dbos.dev/typescript/integrating-dbos](https://docs.dbos.dev/typescript/integrating-dbos), [README](https://github.com/dbos-inc/dbos-transact-ts) | 2026-09-02 |
| U-2b | **SQLite existe chez DBOS, mais côté Go seulement** — release *DBOS Golang v0.17*, juin 2026 : « Added support for SQLite as a durability backend ». Rien pour TypeScript ni Python. | [What's New in DBOS — June 2026](https://www.dbos.dev/blog/new-in-dbos-june-2026) | 2026-09-02 |
| U-2c | **Pas d'option embarquée en TS.** Les deux seules voies documentées sont un Postgres déjà installé (`DBOS_SYSTEM_DATABASE_URL`) ou **un Postgres dans Docker** (`npx dbos postgres start`). | [docs.dbos.dev/quickstart](https://docs.dbos.dev/quickstart) | 2026-09-02 |
| U-3 | **`temporalite` est archivé** (dépôt `temporalio/temporalite-archived`, « experimental distribution »), remplacé par le dev server du CLI. | [temporalio/temporalite-archived](https://github.com/temporalio/temporalite-archived) | 2026-09-02 |
| U-3b | **Le dev server Temporal n'est pas destiné à la production** : il « skips certain HTTP security checks », utilise **une base en mémoire par défaut** (persistance SQLite possible mais non-défaut), et la doc renvoie explicitement au self-hosted guide ou à Temporal Cloud pour la production. | [docs.temporal.io — Run a development server](https://docs.temporal.io/develop/run-a-development-server) | 2026-09-02 |
| U-4 | **Restate est sous Business Source License 1.1** — en-tête du fichier `LICENSE`, licencieurs « Restate Software, Inc., Restate GmbH ». Non-OSI. | [`restate/LICENSE`](https://raw.githubusercontent.com/restatedev/restate/main/LICENSE) | 2026-09-02 |

## 2. Application du critère de décision d'ADR-000

Le critère d'ADR-000 fait tomber les **éliminateurs durs avant** la
comparaison sur la failure matrix. Voici leur état, requirement par
requirement, pour la **cible première** (`local-single-node`,
`EXECUTION_PROFILE_REQUIREMENTS.md §1.1`).

| Option | REQ-6 (MIT / OSI) | REQ-2 (self-contained, no external daemon) | REQ-4 (TS / Bun) | Verdict cible première |
|---|---|---|---|---|
| **A** Native kernel | n/a (code maison) | ✓ par construction | ✓ | **SURVIT** |
| **B** DBOS | ✓ **MIT** (U-1) | ✗ **Postgres obligatoire en TS** — installé ou Docker (U-2, U-2c) | ✓ | **ÉLIMINÉ** |
| **B′** DBOS-Go (SQLite) | ✓ MIT | ✓ SQLite embarqué (U-2b) | ✗ **sidecar Go** dans une stack TS/Bun | **ÉLIMINÉ** |
| **C** Restate | ✗ **BSL 1.1**, non-OSI (U-4) | — | ✓ | **ÉLIMINÉ** |
| **D** Temporal | ✓ SDK MIT | ✗ **dev server non-production**, in-memory par défaut ; `temporalite` archivé (U-3, U-3b) ; le serveur complet est un démon externe | ✓ | **ÉLIMINÉ** |

**L'élimination de B est plus forte que ce qu'ADR-000 anticipait.** L'ADR
écrivait « si DBOS-SQLite est **instable** → éliminé ». La mesure dit autre
chose : DBOS-SQLite, côté TypeScript, **n'existe pas**. Ce n'est pas une
question de maturité.

## 3. Conséquence — le spike comparatif §38 est sans objet

Le second tour devait s'achever par un spike comparatif A vs B vs D sur la
failure matrix du plan §38. **Il ne sera pas exécuté, et c'est le résultat
correct** : on ne compare pas des options déjà éliminées par des
éliminateurs durs. Le critère d'ADR-000 les fait tomber en amont de la
comparaison — c'est précisément sa structure.

Il reste donc **une seule option pour la cible première : A**.

## 4. Ce que cela ne dit PAS — limites explicites

1. **A n'a pas « passé » un spike.** A survit **par élimination**, pas par
   démonstration : le kernel natif n'existe pas encore, donc rien ne l'a
   mesuré. Le critère d'ADR-000 doit être réécrit pour dire cela, au lieu
   d'invoquer une comparaison qui n'a pas eu lieu et n'a plus lieu d'être.
   C'est la résolution de **F-M2-04**.
2. **Les éliminations sont bornées à la cible première.** Elles reposent sur
   REQ-2 (pas de démon externe), qui est une exigence du profil
   `local-single-node`. Sur un futur profil serveur, DBOS-Postgres et
   Temporal-serveur redeviennent des candidats techniquement valides. Mais
   le plan §1-§2 interdit deux autorités durables : adopter A pour la cible
   première engage le produit, sauf ADR de migration explicite.
3. **Rien ici ne mesure le coût d'implémentation de A.** M0-01 l'avait
   quantifié en ADR : 7 ADR à rendre (001, 002, 004, 007, 008, 020, 022)
   avant qu'un kernel natif soit utilisable. Ce chiffre est inchangé.
4. **Rien ici ne réhabilite le runtime actuel.** Ce que M0-01 a établi reste
   vrai et indépendant du choix : `@unifia/workflow-runtime` n'est pas
   substrate-grade, et il perd des données silencieusement sur trigger
   dupliqué. A signifie *réécrire*, pas *conserver*.
5. **Vérification documentaire, pas empirique.** Aucune de ces sources n'a
   été exécutée. Ce sont des `VERIFIED` au sens « lu à la source primaire »
   (fichier `LICENSE`, doc officielle, note de release), pas au sens
   « reproduit par une commande ». Pour des éliminateurs de license et de
   topologie de déploiement, c'est le bon niveau de preuve ; ce ne le serait
   pas pour une propriété de correction runtime.

## 5. Statut

| Élément | Statut |
|---|---|
| Code de production modifié | **NON** |
| Dépendance ajoutée | **NON** (aucun `bun add`, lockfile intact) |
| U-1 / U-2 / U-3 / U-4 | **LEVÉES** |
| Spike comparatif §38 | **SANS OBJET** (éliminateurs durs en amont) |
| Options survivantes (cible première) | **A seule** |
| Décision ADR-000 | **PRÊTE À RATIFIER** — décideur : Erwan (engagement irréversible) |

## Liens

- `docs/adr/ADR-000-durable-execution-substrate.md`
- `docs/automation-v2/spikes/M0-01-EVIDENCE.md` (premier tour)
- `docs/automation-v2/EXECUTION_PROFILE_REQUIREMENTS.md` §1.1, §5
- `docs/automation-v2/RISK_REGISTER.md#R-014`
- plan V2.3.1 §34-40 (candidats, failure matrix), §194 (M0-01)
