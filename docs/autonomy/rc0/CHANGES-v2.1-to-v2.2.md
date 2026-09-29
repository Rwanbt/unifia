# Changements v2.1 → v2.2 (suite aux précisions du propriétaire, 29/09/2026)

| Précision du propriétaire | Effet |
|---|---|
| « On ne fait pas de bêta, mais directement des releases » | QA14 n'est plus « créer un canal beta » : c'est un audit du pipeline `release.yml`. Tous les libellés « beta.1/beta.2 » deviennent « release 1/2 candidate ». Les tâches RL04–RL07 sont faites par le propriétaire. |
| « La branche par défaut est `main` » | Contradiction de `AGENTS.md` tranchée ; carte DOC01 pour corriger le fichier. La carte RB00 attend `main`. |
| « Le travail auto s'arrête à `dev` ; je passe de `dev` à `main` après mes tests manuels » | Nouvelle tâche `owner_only` P0 (synchronisation unique `dev` ← `new-ui`). Les lots des agents partent de `origin/dev` et sont des PR ≤ 400 lignes vers `dev`. RL03–RL07 sont `owner_only`. Aucun agent ne touche `main`, ne tague ni ne publie. La chaîne `new-ui → work-design → dev → main` disparaît au profit de `dev` ← `new-ui` (une fois) puis `main` ← `dev` (par toi). |

## Effets de cascade vérifiés dans le dépôt

- Un push sur `dev` déclenche des workflows avec effets sortants : `containers.yml` (images vers `ghcr.io/<propriétaire>`, déclenché par la synchronisation qui touche `packages/containers/**` et `package.json`), `generate.yml` (commit bot à chaque push), `nix-hashes.yml`. D10 et O5 les traitent.
- Le gate `work-design-integrity` (400 lignes par PR vers `dev`) n'est plus un obstacle pour les lots ; il ne bloque que P0. Le delta `dev` → `new-ui` touche 2410 fichiers.
- Effet sur les délais : la voie critique passe par P0 puis Voice ; la release 1 candidate est estimée ≈ 7 à 9 semaines côté agent, hors tes tests manuels.
