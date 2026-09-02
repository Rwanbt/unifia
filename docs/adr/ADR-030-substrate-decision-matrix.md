<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-030 — Substrate Decision Matrix (P-1 / P-2 evidence pack)

> **Statut** : DECIDED
> **Date** : 2026-09-02
> **Source** : ADR-000 §397-431 (P-1, P-2 product policy decisions open),
>   REQ-4 (runtime language policy), REQ-6 (license compatibility),
>   REQ-7 (self-hostable), REQ-10 (single authority),
>   plan V2.3.1 §186-188 (certification profiles),
>   EXECUTION_PROFILE_REQUIREMENTS.md §1.8 (no UNSUPPORTED profile).
> **Cible** : ce memo **n'est PAS** un ADR architectural mais un
>   **evidence pack** destiné à la décision utilisateur. Il fige la
>   matrice de décision et les critères d'élimination pour aider à
>   trancher P-1 et P-2.

## Status

DECIDED **en tant que document de référence**. C'est un **mémo
méta** (un ADR-030 qui documente un processus de décision, pas une
décision technique). Son seul effet est de produire une matrice
réutilisable chaque fois que l'écosystème du substrate évolue
(nouveau candidat, nouvelle licence, etc.).

Les **décisions P-1 et P-2 elles-mêmes restent à l'utilisateur**.

## Contexte

ADR-000 a 4 options (A Native, B DBOS, B' DBOS-Go, C Restate, D
Temporal). Deux questions de politique produit bloquent la
ratification :

- **P-1** : REQ-6 = OSI-only (strict) ou juridiquement compatible
  (large) ?
- **P-2** : REQ-4 = politique de runtime interdisant tout nouveau
  sidecar dans un langage absent de la distribution Unifia ?

Ce memo fournit la **matrice de décision** : étant donné une
réponse à P-1 et P-2, quelles options survivent, et dans quel
ordre de préférence.

## Decision (méta)

### P-1 — REQ-6 strict vs large

| Lecture | Définition opérationnelle | Licences acceptées | Refusées |
|---|---|---|---|
| **Strict (OSI-only)** | Le substrate doit être sous une licence **OSI-approved** (cf. <https://opensource.org/licenses>) | MIT, Apache-2.0, BSD-2/3, MPL-2.0, ISC, 0BSD, ... (~80 licences) | BSL, SSPL, Elastic License, AGPL, BUSL, Server Side Public License |
| **Large (juridiquement compatible)** | Le substrate doit être juridiquement utilisable par Unifia pour son cas d'usage, redistribution comprise | Tout ce qui est strict + licences source-available avec Additional Use Grant couvrant Unifia (Restate, MariaDB BSL, etc.) | AGPL (copyleft fort), licences custom restrictives sans grant explicite |

**Recommandation** : la lecture **stricte** est plus sûre à long
terme. Elle élimine définitivement Restate (BSL → Elastic License
depuis 2024) et tout futur candidat qui change de licence sans
préavis. La lecture large est justifiable si on a un avantage
technique majeur (SDK TS, single binary, RocksDB embarqué) qui
justifie le risque commercial de licence changeante.

Si **strict** → C (Restate) éliminé. Si **large** → C reste en
course avec A, B, D.

### P-2 — Runtime policy

| Décision | Définition opérationnelle | Sidecars autorisés pour `local-single-node` |
|---|---|---|
| **Adoptée (politique stricte)** | Tout sidecar distribué doit être écrit dans un langage déjà présent dans la distribution Unifia (TS via Bun, Rust via Tauri) | TS via Bun, Rust via Tauri. B′ (DBOS-Go) éliminé. |
| **Non adoptée** | Tout sidecar est techniquement acceptable sous réserve de qualification (packaging, IPC, signing, lifecycle, cross-platform, mobile) | Tout, y compris Go, Rust, C++. B′ requiert qualification. |

**Recommandation** : la politique **adoptée** simplifie énormément
le modèle de menace (Threat Model §1), le packaging (un seul
runtime à bundler), et la portabilité mobile future. La non-adoptée
est justifiable si on a besoin d'un runtime très spécifique (ex.
PostgreSQL écrit en C) qui n'a pas d'équivalent dans la
distribution actuelle.

Si **adoptée** → B′ éliminé. Si **non adoptée** → B′ requiert
qualification de packaging avant ratification de A.

## Matrice de décision (4 scénarios)

| Scénario | P-1 | P-2 | A (Native) | B (DBOS-TS) | B' (DBOS-Go) | C (Restate) | D (Temporal) |
|---|---|---|---|---|---|---|---|
| **S1** strict + adoptée | OSI | strict | ✓ viable | ✓ viable | ✗ éliminé | ✗ éliminé | ✓ viable |
| **S2** strict + non adoptée | OSI | laxiste | ✓ viable | ✓ viable | ? qualifier | ✗ éliminé | ✓ viable |
| **S3** large + adoptée | juridique | strict | ✓ viable | ✓ viable | ✗ éliminé | ✓ viable | ✓ viable |
| **S4** large + non adoptée | juridique | laxiste | ✓ viable | ✓ viable | ? qualifier | ✓ viable | ✓ viable |

**Note** : dans S2 et S4, B′ n'est pas éliminé mais doit être
qualifié (worktree séparé, scope `M0-04-qualify-dbos-go`).

## Ordre de préférence par scénario

Le tableau ci-dessous donne la **préférence technique** (pas la
décision) en partant du principe que A est l'option pressentie
d'ADR-000 §434.

### S1 (strict + adoptée) — **recommandé**

1. **A (Native)** — option pressentie d'ADR-000. Sovereignty maximale,
   pas de dépendance externe volatile, aligné avec la doctrine
   local-first.
2. **D (Temporal)** — robuste, MIT, single authority, mais
   `temporalite` est early stage. Plan B acceptable.
3. **B (DBOS-TS)** — wrap functions, dépendance externe, packaging
   incertain. Plan C acceptable.

### S2 (strict + non adoptée)

Identique à S1 pour l'ordre A, D, B. B′ reste en plan D
conditionnel après qualification.

### S3 (large + adoptée)

1. **A** — toujours préféré.
2. **C (Restate)** — single binary, RocksDB embarqué, SDK TS. Avantage
   technique réel pour le profile `local-single-node` (un seul
   process). Risque : Elastic License.
3. **D** et **B**.

### S4 (large + non adoptée)

1. **A** — toujours préféré.
2. **C** — comme S3.
3. **B′** — si qualifié.
4. **D**, **B**.

## Implications pratiques par option

### A (Native) — toujours viable

- **Effort** : élevé (12+ cartes M1-M3, plan §195-201). 3+ mois
  d'ingénierie full-time minimum.
- **Risque** : substrate engineering notoirement difficile. DBOS et
  Restate ont résolu ces problèmes en 5+ ans. Bugs subtils probables.
- **Avantage** : souveraineté totale, pas de dépendance volatile,
  alignement parfait avec la doctrine.

### B (DBOS-TS)

- **Effort** : moyen (M1-M3 + adaptations pour node families du plan
  §57).
- **Risque** : DBOS-SQLite instable (preview), DBOS n'est pas
  Android-portable. Mises à jour DBOS peuvent casser la compat.
- **Avantage** : MIT, TS natif, pattern récup robuste.

### B' (DBOS-Go)

- **Effort** : faible à moyen (DBOS expose un binaire, on l'embarque).
- **Risque** : packaging Go (Bun ne sait pas bundler du Go), pas
  Android, runtime supplémentaire à maintenir.
- **Avantage** : DBOS-Go est plus mature que DBOS-TS.

### C (Restate)

- **Effort** : moyen.
- **Risque** : **licence BSL → Elastic License** depuis 2024. Pas
  OSI-approved. Si REQ-6 strict, éliminé. Si large, le Additional
  Use Grant couvre Unifia aujourd'hui mais peut changer.
- **Avantage** : single binary, RocksDB embarqué, SDK TS, single
  authority par invocation.

### D (Temporal)

- **Effort** : moyen-élevé (SDK TS + `temporalite`).
- **Risque** : `temporalite` est early stage et marqué « pas
  production » par Temporal. Mais la SDK TS serveur est mature.
- **Avantage** : MIT, robuste, single authority, timer durable, signal,
  query, effect identity, écosystème riche.

## Recommandation finale (méta-recommandation, pas décision)

**S1 (P-1 strict + P-2 adoptée) avec option A (Native)** :

- **Rationale P-1 strict** : la doctrine Unifia est souveraineté
  + local-first. Une licence OSI-approved est une garantie
  décennale, alors qu'une licence source-available peut changer
  unilatéralement (cf. Restate BSL → Elastic, HashiCorp BSL,
  CockroachDB CCL).
- **Rationale P-2 adoptée** : la distribution Unifia actuelle
  (Bun pour le workbench, Tauri/Rust pour le desktop, zod pour la
  validation) est suffisante pour implémenter un substrate durable
  en TS ou en Rust. Tout nouveau sidecar serait un coût de
  packaging, de signing, de cross-platform et de portabilité
  mobile non négligeable.
- **Rationale A** : l'effort d'ingénierie est élevé, mais c'est le
  seul alignement parfait avec la doctrine. C'est l'option qui
  survit à toutes les évolutions de l'écosystème (changement de
  licence DBOS, dépréciation de `temporalite`, etc.).

**Si S1 est rejeté** : S3 (P-1 large + P-2 adoptée) avec C
(Restate) en plan B et D (Temporal) en plan C est le fallback
recommandé.

## Conséquences (si P-1 strict + P-2 adoptée + A ratifié)

- 8 cartes runtime (M1-10/11, M2-07/08/09, M3-08/09/10) sont
  débloquées.
- ADR-000 peut être ratifié (statut : DECIDED, pas
  CHANGES_REQUIRED).
- Le M0 substrate proof (plan §194) peut commencer.
- Les certifications `Automate Core × local-single-node × Windows`
  peuvent être exécutées.

## Conséquences (si autres scénarios)

- **S2 (P-1 strict, P-2 non adoptée)** : B′ requiert qualification
  séparée (worktree, scope M0-04). Pas bloquant pour A.
- **S3 (P-1 large, P-2 adoptée)** : C revient, à qualifier aussi.
- **S4 (P-1 large, P-2 non adoptée)** : C et B′ requièrent
  qualification.

## Liens

- `docs/adr/ADR-000-durable-execution-substrate.md` (CHANGES_REQUIRED)
- `docs/adr/ADR-001-canonical-serialization-digest.md` (DECIDED)
- `docs/adr/ADR-004-durable-history-authority.md` (DECIDED)
- `docs/adr/ADR-008-scheduler-worker-time-authority.md` (DECIDED)
- `docs/adr/ADR-022-timer-timeout-cancellation.md` (DECIDED)
- `docs/automation-v2/THREAT_MODEL.md` §1 (single authority)
- `docs/automation-v2/EXECUTION_PROFILE_REQUIREMENTS.md` §1.8
- `docs/automation-v2/certification/gates.yaml` §10 (M0 substrate
  proof, NOT_BUILT)
- `vault/.../UNIFIA-Automate-Master-Implementation-Plan-V2.3.1.md`
  §186-188 (certification profiles)
- `vault/.../AGENTS.md` (doctrine souveraineté + local-first)

## Décision utilisateur (à compléter)

Cocher la cellule choisie :

- [ ] **S1** strict + adoptée
- [ ] **S2** strict + non adoptée
- [ ] **S3** large + adoptée
- [ ] **S4** large + non adoptée

Et dans le scénario choisi, indiquer l'option substrate
préférée (A, B, B', C, D) :

- [ ] **A** Native
- [ ] **B** DBOS-TS
- [ ] **B'** DBOS-Go (si autorisé par P-2)
- [ ] **C** Restate (si autorisé par P-1)
- [ ] **D** Temporal

Une fois cochée, ADR-000 peut être amendé pour refléter le choix
et ratifié.
