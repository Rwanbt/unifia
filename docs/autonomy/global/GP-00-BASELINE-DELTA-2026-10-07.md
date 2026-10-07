<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# GP-00 — Baseline-delta et disposition des références

Observation du 2026-10-07, exécutée sur `origin/dev@b50f74f80a`. Ce document est la
sortie inventaire de GP-00 : il fige la baseline réelle et classe chaque référence
observée. Il ne fige pas la baseline d'implémentation pour les lots aval, ne ferme
aucun lot et n'accorde aucun droit d'écriture sur les chemins produit.

Toutes les valeurs ci-dessous sont mesurées, pas recopiées du dossier v1.5.4. Quand
elles contredisent `REPO-ALIGNMENT.md` (observation du 2026-09-15), la mesure fait foi
et l'écart est écrit.

## 1. Identité du dépôt

| Élément | Valeur observée | Moyen |
|---|---|---|
| Remote | `https://github.com/Rwanbt/unifia.git` | `git remote get-url origin` |
| Racine Git réelle | `D:/App/unifia/_rc0-laneA` (worktree) | `git rev-parse --show-toplevel` |
| `D:/App/unifia` | **n'est pas** un dépôt Git | `git rev-parse --is-inside-work-tree` → fatal |
| Branche d'intégration | `dev` | mandat RC-0 |
| `origin/dev` | `b50f74f80ac8b3a76ca42541cbbbd04a6301b80e` | `git rev-parse` |
| `origin/main` | `207ff452b8056ae11d1f71e23198e520835f70ed` | `git rev-parse` |
| Arbre de travail | propre | `git status --short` |

Le dossier affirmait déjà que `D:/App/unifia` n'est pas un dépôt : **c'est confirmé**.
La racine réelle est un worktree, pas le dossier parent — quiconque exécutera GP-01
depuis `D:/App/unifia` ne trouvera aucune Git.

## 2. Disposition des références

Distances par `git rev-list --left-right --count A...B` (gauche = commits propres à A).

| Référence | SHA | vs `dev` | Disposition | Fondement |
|---|---|---|---|---|
| `main` | `207ff452b8` | `0 / 1691` | **ANCESTOR_OF_DEV** | 0 commit propre ; ancêtre strict vérifié |
| `dev` | `b50f74f80a` | — | **INTEGRATION_BASELINE** | cible du mandat |
| `work-design` | `609f2d4940` | `885 / 0` | **MERGED_INTO_DEV** | 0 commit propre |
| `new-ui` | `952b7b0ad2` | `2 / 225` | **SUPERSEDED** | `DEC-NEW-UI-2026-10-07` |

### Le renversement par rapport au dossier

Le dossier mesurait `dev` **740 commits derrière** `new-ui`. C'est l'inverse aujourd'hui :
`dev` porte **225 commits de plus**. RC-0 a avancé sur `dev` pendant que `new-ui`
restait à sa tête du 29 septembre.

`main` n'a pas bougé d'un commit depuis l'observation du 2026-09-15 : même SHA. Toute
la livraison du programme s'est faite sur `dev`.

### `new-ui` : ce qui est réellement unique

`git cherry -v origin/dev origin/new-ui` :

```
+ bdb394166e docs(audit): add the wiring findings to the deferred tickets
- 952b7b0ad2 fix(mobile): compact the composer and centre the context ring
```

`-` = déjà présent dans `dev` par patch-id. Le correctif mobile a donc été réintégré
par le travail RC-0 et **ne doit pas être replanté**. Le seul apport non équivalent est
un fichier d'audit, dont les sections 12 à 15 sont préservées dans ce lot
(`docs/audit/DEFERRED-TICKETS-NEW-UI.md`).

## 3. Campagne concurrente UI-M3

`tasks.json › concurrent_campaigns_to_reconcile` portait
`DISPOSITION_REQUIRED_BY_GP-00`. Le validateur refuse toute clôture de GP-00 et toute
activation de GP-20…28/91/92 tant que ce statut tient.

Fait mesuré : `git merge-base --is-ancestor 9aabd75cd10ec4e9886424ee4420a4022199d871 origin/dev`
→ **exit 0**. La baseline déclarée de la campagne est un ancêtre strict de `dev` : ses
tranches sont absorbées.

Disposition retenue par le propriétaire — `DEC-UI-M3-2026-10-07`, statut
`OWNER_DECISION_RECORDED`. M3 est **supersédée par `dev`** ; ses tranches ne sont pas
requalifiées en enfants GP-2x. Conséquence sur un fichier du dépôt :
`docs/ui-reference/v110/M3-PROGRESS.md` pointait encore sur `new-ui` / `69e310a055` et
est corrigé dans ce lot.

## 4. Registres de plans antérieurs

Inventaire du dossier confronté à `origin/dev` avec `git cat-file -e` :

| Registre | Sur `dev` | Disposition |
|---|---|---|
| `docs/autonomy/PLANS-ADRS-INDEX.md` | présent | **KEEP** (lecture seule) |
| `docs/autonomy/plans/` | 52 fichiers | **KEEP** (lecture seule) |
| `docs/autonomy/EXECUTION-LOG.jsonl` | présent | **KEEP** (lecture seule) |
| `docs/autonomy/TASK-GRAPH-DRAFT.yaml` | **présent** | **KEEP** (lecture seule) |
| `docs/autonomy/TASK-GRAPH-v1.0.yaml` | **présent** | **KEEP** (lecture seule) |
| `docs/autonomy/TASK-GRAPH-v1.1.md` | **présent** | **KEEP** (lecture seule) |
| `docs/autonomy/TASK-GRAPH-v2.0.yaml` | **présent** | **RATIFY_SUPERSEDED** — le dossier le déclarait déjà superseded |
| `docs/autonomy/PLAN-DIRECTEUR-V3.md` | **présent** | **KEEP** (lecture seule) |
| `docs/autonomy/BLOCKED-DECISIONS.md` | **présent** | **KEEP** (lecture seule) |
| `docs/autonomy/MIGRATION-PLAN.md` | **présent** | **KEEP** (lecture seule) |

Décision : `DEC-TRACKERS-2026-10-07`. **Les dix registres sont présents sur `dev`** ; aucun
n'est à retirer. Seul `TASK-GRAPH-v2.0.yaml` reste marqué superseded, ce que le dossier
avait lui-même constaté. Le suivi vivant est aujourd'hui `docs/autonomy/rc0/`, les Issues
GitHub et le vault.

> **Correction d'une erreur de mesure, consignée volontairement.** Une première passe
> avait interrogé `TASK-GRAPH-DRAFT.yaml` etc. à la **racine** du dépôt au lieu de
> `docs/autonomy/`, et concluait à tort que six registres étaient absents. Le chemin
> correct les trouve tous présents. Les lignes « absent » de la version initiale de ce
> tableau étaient donc fausses, et la disposition correspondante aussi. La présence
> réelle est ici, mesurée avec `git cat-file -e origin/dev:docs/autonomy/<fichier>`.
> C'est précisément le piège que START-HERE nomme : *« Les commandes produit du
> catalogue sont historiques : vérifier leur présence dans la baseline avant
> exécution. »*

## 5. Lignées locales classées

| Lignée | Présence | Disposition |
|---|---|---|
| `D:/App/unifia/unifia-execution-clean` | présent | à qualifier par un lot propriétaire — hors périmètre GP-00 |
| `D:/App/unifia/_migration-recovery-2026-08-15` | présent | idem |
| `D:/App/unifia/_a7-automate-memory` | présent | worktree `new-ui`, rendu obsolète par §2 |
| `*.bundle` | **124** fichiers (le dossier en comptait 123) | inventoriés, non ouverts |

Les 124 bundles n'ont pas été inspectés : ils sortent du write set de GP-00
(`docs/autonomy/**`, `AGENTS.md`) et leur contenu n'est pas nécessaire pour la baseline.
Le compte passe de 123 à 124 : un bundle s'est ajouté depuis l'observation.

## 6. Sources S7/S8 et précédence

Enregistrées dans `source-register.json` et `supersession-matrix.json` du dossier, avec
les trois enregistrements `SUP-S6-18-S7`, `SUP-S6-19-S7`, `SUP-S6-23-S7` repris sur la
carte GP-00. Leur couverture face à S4/S5/S6 n'a pas été rouverte ici : elle relève du
gate `K3-INF-AUTHENCY-BRIDGE`, propriété de GP-10. **Aucune source future n'a été
observée** qui remplacerait silencieusement la consolidation.

## 7. Environnement et CI

| Élément | Valeur observée |
|---|---|
| Python du dossier | 3.13.7 (≥ 3.11 exigé) |
| Checks requis | `check-compliance`, `check-standards`, `conformance`, `rust unit tests`, `sdk in sync with server`, `unit (linux)`, `unit (windows)` |
| Analyse | `CodeQL`, `Analyze (javascript-typescript)` — suivies, non requises |
| Non requis | `e2e (linux)`, `check-duplicates` |

`check-duplicates` : **la cause racine du blocage est corrigée dans `#348`, le symptôme ne
l'est pas.** Un `if:` de job faux n'empêche pas le run d'être **mis en file** contre
`blacksmith-4vcpu-ubuntu-2404`, il ne saute que les steps, d'où `runner_id=0` et
`steps=0`. `#348` passe `runs-on` sur `ubuntu-latest` et déplace la garde dans les steps :
le job redevient planifiable. Mais mesuré sur `#378` le 2026-10-07T03:27Z, il reste en
file derrière un backlog :

```
pr-management run 37554859491
  add-contributor-label   completed  success     <- même run, même runner
  check-duplicates        queued
47 runs pr-management en file, le plus ancien de 2026-10-06T02:20:04Z, toujours en file
```

Même symptôme observable, cause désormais différente : plus un label sans runner, mais
un backlog de `pr-management` qui ne draine pas. L'issue #59 est donc **rouverte** — elle
avait été fermée sur la seule intention du correctif, sans observer le check signaler.

Le contrôle qui l'aurait attrapé est bon marché : ouvrir une PR après le merge et
vérifier que le check *signale*. C'est ce contrôle qui manque ici.

`e2e (linux)` dépasse son plafond de 110 minutes sur les runs longs. Conséquence
directe pour GP-00 : **aucune corroboration CI n'est disponible pour l'e2e**, donc
toute classification e2e de ce programme repose sur une exécution locale isolée
(`PLAYWRIGHT_WORKERS=1`, `PLAYWRIGHT_RETRIES=0`) et doit être écrite comme telle.

## 8. Contrôles du dossier

Sept contrôles exécutés depuis `docs/autonomy/global` avant toute attribution, puis
relancés après enregistrement des décisions :

| Contrôle | Verdict |
|---|---|
| `verify_pack.py` | `PASS_PACK_INTEGRITY` |
| `validate.py --self-test` | `PASS_DOCUMENT_STRUCTURE_AND_LIFECYCLES` |
| `test_packets.py` | `PASS` |
| `test_lifecycle.py` | `PASS` |
| `test_proof_contracts.py` | `PASS` |
| `test_phase_contracts.py` | `PASS` |
| `render_tasks.py` | aucune dérive de projection |

`certify_pack.py` → `PASS_CERTIFIED_AND_SEALED`, 190 fichiers re-hachés.

### Défaut corrigé dans le validateur

Enregistrement de la disposition UI-M3 → `certify_pack.py` a échoué. Cause racine
mesurée : les deux cas négatifs `validate.py:639-640` (« UI lot active before UI-M3
disposition » et « UI child packet claimed before UI-M3 disposition ») supposaient que
la campagne n'était **pas** dispositionnée, en héritant de l'état vivant du pack au
lieu de poser leur propre précondition. Contrôle isolé : `self-test` sort **0** quand la
campagne est remise à `DISPOSITION_REQUIRED_BY_GP-00`, et échoue dès que la disposition
est enregistrée.

Autrement dit, le pack ne pouvait pas à la fois avoir UI-M3 dispositionnée — ce que la
validation de GP-00 exige — et passer sa propre certification.

Correctif (autorisé par le propriétaire) : les deux cas posent maintenant eux-mêmes
`DISPOSITION_REQUIRED_BY_GP-00` avant de muter GP-21 ou son paquet. **Le message
attendu est inchangé**, donc le gate n'est pas affaibli : `bad_specific` exige toujours
le refus exact. Le test porte désormais sa précondition au lieu de l'hériter.

Ce défaut est réel et dépasse cette session : un test de non-régression du validateur
ne doit pas dépendre d'un état mutable du pack. Il mérite une révision à la source du
dossier.

## 9. Issues liées

| Issue | État au 2026-10-07 | Lien GP-00 |
|---|---|---|
| #58 | **CLOSED** (`e957f7d2e4` publié dans le lot #376) | lot observationnel terminé |
| #59 | **OPEN** — `#348` a supprimé le blocage par label, pas le symptôme ; voir §7 | CI de dev |
| #77 | **CLOSED** | CR01, traité |
| #155 | **CLOSED** | QA04, traité |
| #284 | **CLOSED** (`2cc26550aa`, PR #336) | CI de dev |
| #56 | OPEN | 3 tests time-sensitive ; (a) traité, (b) hors périmètre `src/` |
| #154 | OPEN | CR04 / CR10 — prochain lot de développement |
| #118 | OPEN | épique Browser |

## 10. Ce que GP-00 ne fait pas

- Il ne fige pas `IMPLEMENTATION_BASELINE_SHA` pour les lots aval : §1 et §2 fournissent
  la matière, le choix du SHA appartient à la reprise de GP-01/02/03.
- Il ne prépare aucun paquet enfant. START-HERE exige « un paquet enfant rempli,
  chemins exacts, une obligation observable, test et revue réservés » ; ce lot ne
  remplit aucune de ces conditions et ne prétend donc pas clôturer GP-00.
- Il n'accorde aucun droit d'écriture sur `packages/**`. Son write set reste
  `docs/autonomy/**` et `AGENTS.md`.
- Il ne qualifie ni le code produit, ni les appareils, ni la CI, ni une publication.
