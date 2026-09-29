# Registre des décisions — Unifia RC-0 (v2.2)

Décisions validées par le propriétaire (Erwan) le **29 septembre 2026**, en conversation. D9 à D11 et les décisions ouvertes n'ont pas encore été tranchées.

## Décisions validées

| # | Sujet | Décision | Conséquence dans le plan |
|---|---|---|---|
| D1 | Politique de `workflow.run` | **A — step-up** : chaque run exige une approbation explicite, jamais ambiante | CR03 tranché : ajouter `workflow.run` à `STEP_UP_ELIGIBLE_CAPABILITIES` (`packages/workbench-server/src/constants.ts`), adapter `capability-scope.test.ts`. Fusion par le propriétaire (carte CR03). |
| D2 | Browser | **A — masqué dans la release 1, livré ensuite en mise à jour progressive** | BR00–BR10 + UI12 en train 2. |
| D3 | Voice | **B — inclus dans la release 1** | VO00–VO05 en train 1, périmètre borné ci-dessous. |
| D4 | Blockers fonctionnels | Implémenter les solutions fonctionnelles (#86, #93, #96) | CR06, CR07, CR08 en train 1. |
| D5 | Plateformes | Windows, Linux, Android | QA13 (train 1). macOS, iOS, Web/PWA : `EXPLICITLY_NOT_IN_THIS_RELEASE` en release 1 ; matrice complète en train 3 (QA11). |
| D6 | Parité visuelle | Considérée atteinte sur `new-ui` | UI00 = vérification (harnais existant, SHA candidat, exe desktop). Pas de re-travail visuel planifié. |
| D7 | Canal de publication | **Pas de bêta : des releases directes.** Voice et Kanban intégrés et fonctionnels dès la release 1 ; Browser en mise à jour progressive | QA14 est réorienté (audit du pipeline de release, plus de canal beta). Kanban = CR06 + FX01. |
| D8 | Branches | `work-design` est déjà entièrement dans `new-ui` (**vérifié** : `work-design`, `dev` et `main` sont des ancêtres de `new-ui`). **La branche par défaut est `main`** | RL02 = fast-forward. `AGENTS.md` se contredit (carte DOC01). |
| D9 | Périmètre du travail automatisé | **Le travail automatisé s'arrête à `dev`.** Le propriétaire décide seul, après ses tests manuels, de passer de `dev` à `main` | Les tâches RL03–RL07 sont réservées au propriétaire (`owner_only`). Aucun agent ne pousse sur `main`, ne tague ni ne publie. |
| — | Objectif | Tout câbler sans exception, étape par étape ; supprimer du câblage = régression d'objectif | Tous les PW/FX/BR sont conservés, répartis en trois trains (= trois releases candidates sur `dev`). |

Lecture retenue de D9 : chaque train se termine par un état de `dev` prêt pour tes tests manuels ; **tu choisis** de promouvoir chaque train vers `main` (donc une release par train) ou d'attendre la fin du train 3. Le graphe supporte les deux.

## Périmètre Voice de la release 1 (validé avec D3)

**Inclus :** Live Android (Oboe, Silero VAD, Smart Turn, STT final Parakeet), chemin desktop Windows, TTS système Android comme repli **étiqueté**, modèles épinglés et vérifiés par hash, Voice en entrée/sortie seulement (ADR-065), CI voice bloquante, qualification physique sur l'appareil Android du propriétaire et un hôte Windows.
**Déplacé au train 2 (VO06) :** Pocket TTS Android, chaîne AEC/NS/AGC, STT streaming Android (NDK), endurance G12, routes Bluetooth, full-duplex G9.
**État vérifié de la branche `voice` (doc de qualification du 27/09/2026) :** « IMPLEMENTATION COMPLETE / PRODUCTION QUALIFICATION BLOCKED ». Qualification physique ouverte, AEC absent, Pocket Android en scaffold, STT streaming Android bloqué par une compilation NDK.

## D10 — Synchronisation initiale de `dev` (P0) : TRANCHÉ 2026-09-29 → option A (PR de promotion, aucune poussée directe sur `dev`)

`dev` est un ancêtre de `new-ui` (0 commit propre, 1457 commits de retard). Le plan propose de **faire d'abord de `dev` la branche d'intégration unique** : une synchronisation unique `dev ← new-ui` (tâche P0, exécutée par le propriétaire), après quoi tous les lots des agents sont des PR ≤ 400 lignes vers `dev`.

Obstacle vérifié : `work-design-integrity.yml` (PR vers `dev`) exécute `scripts/check-pr-size.sh dev`, limite de **400 lignes**. Le delta `new-ui` → `dev` touche **2410 fichiers**.

| Option | Principe | Avis |
|---|---|---|
| A | Exemption explicite et versionnée du gate pour une PR de promotion (par ex. branche de tête `promote/*`), relue par le propriétaire ; PR en *merge commit* | Recommandée si tu veux que tout passe par PR |
| B | Le propriétaire pousse le SHA figé sur `dev` avec contournement de règle (`git push origin <SHA>:dev`, fast-forward puisque `dev` est ancêtre) | Le plus simple ; demande le droit de contournement |
| C | Tranches ≤ 400 lignes | Écartée (2410 fichiers) |

Dans A comme B, préfère un *merge commit* ou un fast-forward à un *squash* : un squash effacerait l'historique de 1457 commits. Décision attendue : A ou B.

**Effets de bord d'un push sur `dev` (vérifiés dans les workflows) :**
- `containers.yml` : sur push vers `dev` si `packages/containers/**` ou `package.json` changent, il construit et **pousse des images vers `ghcr.io/<propriétaire>`** (`--push`). La synchronisation touche les deux : il se déclenchera.
- `generate.yml` : à **chaque** push sur `dev`, régénère et pousse un commit bot (`git push origin HEAD:dev --no-verify`). `dev` bougera donc sans que les agents y touchent.
- `nix-hashes.yml` : peut pousser un commit de retour sur `dev` (filtré par chemins).
- `release-github-action.yml` : ne se déclenche que si `github/**` change (non concerné par la synchronisation).
- `publish.yml` : se déclenche sur `dev`, mais le job `version` est gardé par `github.repository == 'anomalyco/opencode'` (donc sauté ici). À confirmer pour les autres jobs (QA14).
- `docs-locale-sync.yml` : désactivé (`if: false`).

## D11 — Fusion des PR des agents dans `dev` : TRANCHÉ 2026-09-29 → (i) les agents fusionnent, sauf CR03/CR03b, `.github/**` et P0

Deux lectures de « s'arrêter à `dev` » : (i) l'agent fusionne lui-même ses PR dans `dev` quand tous les checks requis sont verts ; (ii) l'agent ouvre les PR et tu fusionnes.
**Proposition :** (i), avec exceptions où **tu** fusionnes : CR03/CR03b (politique de sécurité), tout changement de `.github/**`, et la synchronisation P0.

## Décisions ouvertes

| # | Sujet | Où elle bloque |
|---|---|---|
| O1 | Politique des contrôles « SOON » : implémenter maintenant ou masquer jusqu'au train concerné (RB07, FX00) | RB05, FX00 |
| O2 | Numéro de version de la première release (`VERSION` = `1.3.15`) | RL04 |
| O3 | Statut de chaque moteur non livré : câbler, parquer ou supprimer (PW00) | PW00 |
| O4 | Fusion de CR03 après relecture sécurité ; sous-question de révocation (CR03b) | CR03, CR04, CR05 |
| O5 | TRANCHÉ 2026-09-29 : **non acceptables**, et pas de poussée directe sur `dev`. Avant la fusion de la PR de promotion, le propriétaire désactive `containers.yml` et `generate.yml` (et `nix-hashes.yml` si son filtre de chemins matche), puis les réactive après. La fusion de la PR étant elle-même un push sur `dev`, elle déclenche ces workflows s'ils sont actifs. | P0, QA14 |

## Actions réservées au propriétaire

P0 (synchronisation de `dev`) ; protection de branches ; tout push sur `main`, toute promotion `dev` → `main`, tags, signatures, publications, secrets ; création/fermeture/commentaire d'issues ; fusion de CR03 et des changements de workflows ; tests manuels et tests physiques (VO04, QA08).

## Faits de dépôt établis pendant la préparation du pack (29/09/2026, `new-ui@2c13b7d`)

1. `work-design`, `dev`, `main` ⊂ `new-ui` (mesuré : 660 / 1457 / 1466 commits d'avance, 0 commit propre). Le delta `dev` → `new-ui` touche 2410 fichiers.
2. `scripts/package-wiring.json` : 27 paquets déclarés non livrés, dont 17 moteurs sans consommateur.
3. Le serveur livré n'injecte pas `browser`, `desktop`, `memory`, `capabilities`, `ui`, `uiAllowedActions`, `skillHub` (routes en 503) — `docs/audit/AUDIT-CABLAGE-NEW-UI-2026-09-30.md`.
4. `release.yml` (tags `v*` ou déclenchement manuel, avec option brouillon) est le pipeline de release Unifia ; il n'a que le canal `latest`. `beta.yml` ne publie rien (synchronise des PR étiquetées) ; `publish.yml` sur la branche `beta` viserait `anomalyco/opencode-beta` : **ne jamais l'utiliser**.
5. `AGENTS.md` contient deux affirmations contradictoires sur la branche par défaut ; le propriétaire confirme : `main`.
6. Le statut des issues GitHub n'a **pas** été vérifié (accès indisponible) : RB01 doit les dispositionner.

