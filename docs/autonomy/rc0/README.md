# UNIFIA — Pack de rebaseline v2.2 (RC-0)

**Date :** 29 septembre 2026 · **Dépôt :** `Rwanbt/unifia` (branche par défaut : `main`) · **Baseline observée :** `new-ui@2c13b7d76d0fdbec33af3952825e6bf84e930df5` (RB00 doit re-lire HEAD)

Ce pack remplace l'**ordre d'exécution** du v2.0 par trois trains. Chaque train se termine par un état de **`dev` prêt pour tes tests manuels** ; le travail automatisé s'arrête là. **Tu décides seul** de passer de `dev` à `main` et de tagger une release. Il n'y a **pas de bêta**. L'objectif est inchangé : tout câbler, sans exception. Le v2.0 reste l'archive normative (`v2.0-archive/`).

## Où déposer ce pack
Dans le dépôt : `docs/autonomy/rc0/`. (`docs/autonomy/TASK-GRAPH-v2.0.yaml` est un ancien graphe Hermes de juillet 2026, sans rapport.)

## Ordre de lecture
1. `DECISIONS.md` — décisions validées (D1–D9), à trancher (D10, D11), décisions ouvertes (O1–O5), faits de dépôt vérifiés.
2. `PLAN-RC0-FASTTRACK.md` — trains, gate, branches (`main` ← `dev` ← lots), effets de bord de `dev`, délais, risques.
3. `STARTUP-PROMPT.md` — prompt complet à copier dans l'agent principal.
4. `cards/` — cartes atomiques : `CARD-RB00`, `RB02`, `RB03`, `RB01`, `VO00` (mesure et documents), `CARD-P0-OWNER` (**pour toi**), `CARD-DOC01`, `CARD-QA14`, `CARD-CR03`.
5. `TASK-GRAPH-RC0.json` — 104 tâches : `train`, `owner_only`, dépendances, critères, périmètres (à résoudre par RB01).
6. `CAPABILITY-MATRIX-v2.2.md`, `ISSUE-MAP-v2.2.md`, `MIGRATION-v2.0-to-v2.2.md`, `CHANGES-v2.1-to-v2.2.md`.
7. `VALIDATION.md`, `SHA256SUMS`.

## Comment l'utiliser
- **Toi d'abord :** réponds à D10 (A ou B), D11 (les agents fusionnent-ils dans `dev` ?) et O5 (effets de bord de `dev` acceptables ?).
- **Agent principal :** colle le bloc de `STARTUP-PROMPT.md`. Il exécute RB00 → RB02 → RB03 → RB01 → VO00 (aucun code), attend que tu aies fait P0, puis prépare DOC01, QA14 et CR03 et enchaîne le train 1.
- **Agent à budget limité (ex. MiniMax M3) :** une carte à la fois ; fichiers autorisés, commandes, preuves et conditions STOP sont bornés, sans décision d'architecture déléguée.
- **Tu gardes :** P0, protections de branche, tout ce qui touche `main`, fusion de CR03 et des changements de workflows, tests manuels et physiques, tags, signatures, publications, issues.

## Délais (estimations côté agent, livraison sur `dev`)
Release 1 candidate : ≈ 7 à 9 semaines (mi-novembre à début décembre 2026) · release 2 : + 3 à 5 semaines · release 3 (programme complet) : ≈ 12 à 16 semaines (fin décembre à mi-janvier). Exclus : tes tests manuels et physiques, P0, RL03–RL07. Le chemin critique du train 1 est la voie Voice. Détails : `PLAN-RC0-FASTTRACK.md` §8.

## Limites de ce pack
- Le statut des issues GitHub n'a pas pu être revalidé (accès indisponible) ; RB01 le fait.
- Les périmètres de fichiers des tâches restent génériques tant que RB01 ne les a pas résolus.
- La validation est mécanique (structure du graphe), pas une certification produit.
