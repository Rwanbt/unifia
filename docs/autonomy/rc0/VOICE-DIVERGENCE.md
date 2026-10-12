<!-- SPDX-License-Identifier: MIT -->
# VOICE-DIVERGENCE — voice vs new-ui (carte VO00, mesurée le 2026-09-29)

merge-base : `f269f049de9c2f946dbdf533bddacb26715b369c`. `origin/voice` = f3f7f03, `origin/new-ui` = 2c13b7d.

## 20 commits propres de `voice` (0 fusion)
| Classe | Commits |
|---|---|
| audio natif Android / Pocket | db135fb (runtime Pocket natif), 245536c + a687bd2 (voix système puis « Pocket ou rien »), 8aee966 (ORT dynamique), b52e7a3 (panic ONNX API), e92ec25 (classification des échecs Live), add3dce, 7080866 (Pocket Windows/MAX_PATH), 61641f7 |
| providers STT/TTS (langue, voix) | 5278425, dbdd4db, ed36183, f3f7f03, a83a421 |
| docs / preuves | 52a27731, af6c347, 77de890, 0223465 |
| autre | ef941d4 (session : scan projet sur un appareil entier) |
| CI voice-ci | aucun commit dédié |

## 42 commits de `new-ui` absents de `voice`
Sans rapport avec Voice pour la quasi-totalité (Automate, Design, Memory, Browser, inspector, sidebar, audit, deps, CI wiring guard). Deux touchent l'audio/live : `e2251a3` (Live : dire pourquoi l'orbe ne démarre pas), `468d697` (feuille de style orb). Partagés : i18n (`ar…zht.ts`) et `settings-audio.tsx`.

## Chevauchement de fichiers modifiés des deux côtés
`packages/app/src/components/settings-audio.tsx` + 17 fichiers `packages/app/src/i18n/*.ts` (locales). Rien dans `packages/contracts/**` ni `packages/sdk/**`.

## Prédiction de conflit
`git merge-tree --write-tree origin/new-ui origin/voice` → **exit 0, aucun CONFLICT** (arbre 4ff98e0f). Attention : l'i18n est audité (parité 16 locales) ; une fusion sans conflit textuel peut casser la parité → lancer le test de parité après.

## Stratégie
Branche `integration/voice-on-dev` depuis `origin/dev` **après P0** ; `git merge origin/voice` (jamais de rebase ni de force-push) ; résolution sémantique ; tests app complets (`bun test` dans `packages/app`, suite entière) + parité i18n ; PR(s) vers `dev` découpées par domaine (≤ 400 lignes hors générés/lockfiles ; si le merge commit dépasse, le découpage passe par des tranches de cherry-pick groupées par classe ci-dessus). Périmètre release 1 (D3) : Live Android (Oboe, Silero, Smart Turn, STT final Parakeet), desktop Windows, TTS système Android en repli étiqueté ; le reste = VO06.
Décision agent à noter : `a687bd2` (« Pocket ou rien », supprime la voix plateforme Android) contredit le repli TTS système de D3 → à arbitrer au moment de VO01.
