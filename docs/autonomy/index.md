# docs/autonomy/ — Index de navigation

**Date :** 2026-07-31
**Statut :** `v2.0` aligné avec TASK-GRAPH v2.0

## Vue d'ensemble

Ce dossier contient la **gouvernance** d'Unifia Workbench : audit, plans, ADRs, rapports, et migration.

## Structure

```
docs/autonomy/
├── index.md (ce fichier)
├── TASK-GRAPH-v1.0.yaml           # 17 cartes initiales (DEPRECATED, v2.0 plus complet)
├── TASK-GRAPH-v1.1.md             # 60+ cartes en markdown (backup)
├── TASK-GRAPH-v2.0.yaml           # 73 cartes alignées état réel (recommandé)
├── BLOCKED-DECISIONS.md           # 9 décisions bloquantes (BD-1 à BD-9)
├── BASELINE.md                    # SHA baseline fork opencode
├── REPO-INVENTORY.md              # Inventaire initial du repo
├── LICENSE-AUDIT-UNIFIA.md        # Audit licences du fork
├── THIRD-PARTY-NOTICES.md         # Notices tiers (269+ deps)
├── UPSTREAM-PROVENANCE.md         # Chaîne de provenance
├── UPSTREAM-SOURCES.lock.json     # Verrous SHA upstream
├── ATTRIBUTION-TEMPLATE.md        # Modèle d'en-tête SPDX
├── DO-NOT-IMPORT.md               # Interdictions d'import
├── IMPORT-CANDIDATES.md           # Candidats à l'import d'OpenWork/OpenCowork
├── TRI-REPO-ARCHITECTURE-INVENTORY.md  # Architecture 3 repos
├── FEATURE-OWNERSHIP-MATRIX.md    # 32 domaines → 5 autorités
├── DUPLICATION-MATRIX.md          # Doublons et compléments
├── PORTABILITY-ASSESSMENT.md      # Évaluation portabilité composants
├── SECURITY-GAP-MATRIX.md         # 6 gaps de sécurité
├── MIGRATION-PLAN.md              # Plan migration non-breaking
├── I18N-USER-INVENTORY.md         # Inventaire i18n utilisateur (16 langues)
├── I18N-USER-INVENTORY.json       # Idem en JSON
├── SBOM-cyclonedx.json            # SBOM CycloneDX 1.5 (22 packages)
├── PLAN-DIRECTEUR-V3.md           # Plan V3 (49 KB, snapshot)
├── plans/                         # 11 plans détaillés + 3 Gates
├── reports/                       # Rapports de session et gates
├── adr/                           # 20 ADRs (0001-0020 + 19 fork legacy)
└── EXECUTION-LOG.jsonl            # Log de tous les events session
```

## Lecture recommandée

### Pour comprendre le projet

1. **README.md** (racine) — point d'entrée
2. **GOVERNANCE.md** (racine) — gouvernance
3. **docs/autonomy/PLAN-DIRECTEUR-V3.md** — plan directeur
4. **docs/autonomy/TASK-GRAPH-v2.0.yaml** — état réel du projet

### Pour contribuer

1. **CODEOWNERS** (racine) — qui review quoi
2. **.github/PULL_REQUEST_TEMPLATE.md** — comment PR
3. **.github/ISSUE_TEMPLATE/** — comment issue
4. **PRODUCTION_READINESS.md** (racine) — critères de qualité

### Pour déployer

1. **scripts/unifia-migrate.sh** — migration opencode → unifia
2. **scripts/unifia-verify.sh** — validation post-install
3. **RELEASE-NOTES.md** — notes de release v1.0.0
4. **MIGRATION-PLAN.md** — plan non-breaking

### Pour la sécurité

1. **SECURITY.md** (racine) — politique de sécurité
2. **docs/autonomy/DO-NOT-IMPORT.md** — interdictions
3. **docs/autonomy/BLOCKED-DECISIONS.md** — décisions bloquantes
4. **docs/adr/0006-policy-engine.md** à **0012-provenance** — ADRs sécurité

### Pour les décisions architecturales

- **docs/adr/** — 20 ADRs (notamment 0001-0015 nouveaux + 0001-0012 héritage fork)

## Statistiques (mise à jour 2026-07-31)

| Catégorie | Nombre |
|---|---:|
| Cartes TASK-GRAPH v2.0 | 73 |
| Plans détaillés | 14 (11 phases + 3 Gates) |
| ADRs (total) | 39 (20 nouveaux + 19 héritage fork) |
| Sous-cartes détaillées | ~120 |
| Rapports de session | 6 |
| Décisions bloquantes | 9 |
| Upstream SHA verrouillés | 2 (OpenWork, OpenCowork) |
| Deps tierces documentées | 269+ |

## Cartes par statut

| Statut | Cartes |
|---|---:|
| INTEGRATED_LOCAL | 60 |
| PARTIAL | 1 |
| DEFERRED | 9 |
| BLOCKED_DEPENDENCY | 2 |
| BLOCKED_SECURITY_CRITICAL | 1 |

## Versions

- **v0.1** (DRAFT) : 17 cartes basées sur hypothèses
- **v1.0** : 17 cartes alignées Plan V3 (statuses obsolètes)
- **v1.1** (md) : 60+ cartes en markdown (backup)
- **v2.0** (yaml) : 73 cartes alignées état réel (recommandé)

## Voir aussi

- [racine REPO-INVENTORY.md](REPO-INVENTORY.md) — inventaire détaillé du repo
- [racine UPSTREAM-STRATEGY.md](/UPSTREAM-STRATEGY.md) — stratégie upstream
- [racine GOVERNANCE.md](/GOVERNANCE.md) — gouvernance Unifia
