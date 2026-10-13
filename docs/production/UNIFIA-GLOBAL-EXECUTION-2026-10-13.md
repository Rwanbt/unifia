# Unifia — programme global actualisé (13 octobre 2026)

> **Statut :** plan d'exécution, non certification. **Source normative (QUOI) :** dossier `UNIFIA-DOSSIER-COMPLET-v1.5.4-REBASELINE-2026-10-13` (8 sources S1–S8, 78 lots GP, 1 251 exigences, 985 intervalles, 25 ADR, 21 gates). Ne pas modifier les contrats historiques sans ADR ratifié.

## Priorité opérationnelle

**S0 : [REPO_CLEAN #597](https://github.com/Rwanbt/unifia/issues/597).** Réconcilier `main → dev` (#587, PR #585), sécuriser le `dev` intégration, qualifier toutes les PR et branches, puis ne conserver durablement que `main` et `dev`. Les branches de travail temporaires restent possibles pendant une PR et doivent être nettoyées après intégration. **Préserver `dev_auto`** comme voie de travail autonome selon la décision rapportée du 12/10, en attente de réconciliation formelle avec l'instruction antérieure à deux branches ; aucune suppression sans validation explicite du propriétaire. Aucun `dev → main`, effacement de commit, merge forcé ou publication implicite.

## Autorité des documents et états

1. **Décisions du propriétaire** : `docs/autonomy/rc0/DECISIONS.md`, décisions d'octobre à confirmer et ADR ratifiés ; **D9 réserve `dev→main`, tags et publication au propriétaire**.
2. **QUOI** : dossier v1.5.4, sources normatives S1–S8, supersessions, exigences et gates ; archives conservées.
3. **QUAND/COMMENT release 1** : `docs/autonomy/rc0/` v2.2 et le backlog RC-1 #581. Les trois trains v2.2 priment sur mon nouvel ordonnancement tant qu'une décision ne les révise pas.
4. **État et GP-00** : `docs/autonomy/global/GP-00-BASELINE-DELTA-2026-10-07.md` contient `DEC-NEW-UI`, `DEC-UI-M3`, `DEC-TRACKERS` ; les registres v1.5.4 non importés restent historiques, pas un second moteur actif. GitHub prouve l'état observé, pas la conformité.
5. **Traçabilité post-RC-1** : [Issue index générale #598](https://github.com/Rwanbt/unifia/issues/598) = couverture 78 GP. [Epic RC-1 #581](https://github.com/Rwanbt/unifia/issues/581) = livraison courte, conserve les issues RC-1 préexistantes. Voir [la matrice d'issues](UNIFIA-GP-ISSUE-COVERAGE.md).

## Trains et gates

| Train | Portée | Tickets existants à conserver | Sortie |
|---|---|---|---|
| S0 — stabilisation | Git, CI, sécurité, branches | #597, #59, #587, #545, #546, #480, #56 | REPO_CLEAN vérifié, voies `dev` et `dev_auto` réconciliées |
| REL-R0 | GP-00..04, GP-90 | #581, #564, #575, #576, #577, #578 | Base installable / release contrôlée |
| REL-RF | GP-10..18 | GP-10..18, #566, #567, #568 | K0, M0.9, FOUNDATION-GATE |
| REL-R1 | GP-20..27, GP-91 | #96, #116, #118, #548..#564 | UI v110 slice réelle |
| REL-R2 | GP-28, GP-30..35, GP-92 | #549, #552, #572, Design historique | UI-FULL-GATE, Design |
| REL-R3 | GP-40..47 | #493, #569 + GP dédiés | SK-G2 / D1 |
| REL-R4 | GP-50..57 | #555..#557, #580 + GP dédiés | SK-G3 / D2 |
| REL-R5 | GP-60..66 | #574 + GP dédiés | SK-G4..G7 / D3 |
| REL-R6 | GP-70..78 | #560 + GP dédiés | INF-T0, INF-BACKEND-GATE |
| REL-R7 | GP-79..81 | #117, #572, #573 + GP dédiés | Diffusion/audio qualifiés |
| REL-R8 | GP-82..85 | #575, #574 + GP dédiés | Plateformes réellement testées |
| REL-R9 | GP-86..89 | GP dédiés | ComfyUI L0-L3/edge qualifiés |
| REL-R10 | GP-93..95 | #578 + GP dédiés | PROGRAM-COMPLETE-GATE |

Les trains REL-R* ci-dessus sont la **trajectoire longue v1.5.4** et ne remplacent pas les **trois trains v2.2** pour la première release. Browser : masqué pour la release 1 selon D2, ensuite train 2 sauf décision propriétaire contraire. Voice : release 1 (périmètre D3). Plateformes de release 1 : Windows, Linux, Android (D5). Parité visuelle : atteinte selon D6, corriger les régressions avérées sans relancer une refonte exhaustive. `SOON` visibles et grisés selon arbitrage du 06/10, jamais fausses actions.

Ces trains forment un graphe de dépendances, **pas un séquencement forcé**. Les dépendances des cartes priment, y compris les liens transversaux (ex. Design dépend des capacités multimodales ciblées). Les tâches futures peuvent être préparées, non activées tant que leurs gates sont bloqués.

## Règle pour chaque user story

- Préflight : référence source exacte, SHAs, owner, ressources/chemins d'écriture et dépendances ; exigences atomisées avant CLAIMED.
- Exécution : PR courte vers `dev`, branche temporaire, journal et reçu de changement ; pas de double autorité.
- Validation : capacité réellement atteignable depuis la build distribuée, permissions/Policy/Trust/Secret/DLP/Grant testés, unité/intégration/E2E ; cas négatifs, crash/recovery, migration/rollback selon risque ; environnement et SHA exacts.
- Clôture : `authority/contract → implementation → transport/persistence → shipped consumer → test/evidence`. Le vert CI partiel, une issue fermée, un composant dormant ou un mock de démonstration ne suffisent jamais.
- Matériel/non disponible : `NOT_RUN` motivé, jamais certificat tacite. Périmètre RC explicitement inclus/exclu avec décision du propriétaire.
- Autonomie : la file courante est S0 puis RC-1 ; ne pas travailler un lot GP en double tant qu'une issue RC-1 couvre le même changement. La voie `dev_auto` ne touche pas `main`/`.github/**` ni les autorités critiques ; promotion en PR vers `dev` après CI complète.
- Autonomie : reprendre les travaux READY sans relire sans cesse le plan complet ; arrêter uniquement un chemin effectivement bloqué et poursuivre les tâches indépendantes ; CI protectrice, pas de contournement.
- Attention : `pull_request_target` lit les workflows depuis `main` ; #59 a été rouverte car `check-duplicates` y est toujours présent. Toute correction `.github/**`/`main` est réservée au propriétaire et doit passer ses protections.
- Livraison : candidate SHA/artefact immuable + tests installation neuve/N-1, signature, SBOM, provenance, smoke, rollback ; promotion de `dev` vers `main` uniquement après gate et approbation propriétaire.

## Sources et livrables

- **78 stories** et leurs critères détaillés : pack `UNIFIA-PLAN-COMPLET-78-USER-STORIES-ISSUES-2026-10-13.zip` remis au propriétaire (dossier téléchargé, non considéré comme présent dans ce dépôt tant que non importé).
- **Couverture GitHub intégrale** : [#598](https://github.com/Rwanbt/unifia/issues/598) et [matrice GP→issue](UNIFIA-GP-ISSUE-COVERAGE.md) ; 52 nouvelles issues GP, 26 GP associés à des issues existantes, plus #597/#598.
- **Objectif présent** : aucune implémentation nouvelle de K3, Browser/Voice, inférence ou multimodal n'est autorisée par ce commit de documentation.

## Écarts Claude Code 13/10 et garde-fous

- [ ] Réconcilier la décision `dev_auto` permanente rapportée du 12/10 avec la demande antérieure à deux branches, sans supprimer `dev_auto`.
- [ ] Corriger GP-28 : **REL-R2**, pas REL-R1. Pour GP-30/31/32, le reliquat Design est suivi en #652 ; GP-34 en #653 ; seams upstream GP-17 en #654.
- [ ] Importer le registre minimal normatif (78 cartes, `tasks.json`, `gates.json`, `source-anchor-map.json`) sur une PR documentaire distincte et limitée, **après** correction du défaut des cas négatifs `validate.py:639–640` ; le pack 15/09 hérite encore du statut UI-M3 et échoue si l'on enregistre GP-00 sans correctif.
- [ ] Les issues GP #599–#650 sont des index longue durée, non directement READY : enrichir dépendances/gates/requirement IDs et les relier aux issues RC-1 correspondantes avant exécution.
- [ ] Vérifier les preuves runtime et matérielles ; `QA01` de #581 reste ouvert jusqu'au check terminal #59. PR #589 a été fermée sans fusion.

