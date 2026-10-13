<!-- SPDX-License-Identifier: MIT -->
# Matrice des capacités

Statuts : `IMPLEMENTED` (code présent), `INTEGRATED` (atteignable depuis le point d'entrée distribué), `TESTED` (exécuté par un test au SHA cité), `E2E_CERTIFIED`, `GA_READY`, `BLOCKED`, `NOT_VERIFIED`. Un statut plus haut exige les statuts plus bas.

Les statuts sont ceux de `dev` à `2d2e2146c9`, sauf mention contraire. « Point d'entrée » = ce que l'utilisateur ou le CLI atteint réellement.

> **RC-1 scope overlay (2026-10-13):** the historical evidence rows below are retained, but RC-1 disposition is now governed by [RC1-SCOPE.md](./RC1-SCOPE.md). A historical `NOT_VERIFIED` or “divergence accepted” is not permission to ship a fake control. Declared-but-unwired items `home.glance`, `shell.workspace-tabs` and `code.diff` are REQUIRED and tracked by #550, #551 and #588. Code Lens/Inline AI remain REQUIRED under #96. Browser (#118/#554), Voice (#117), Work/Automate/Settings closure (#555-#563/#580), package reachability (#565-#574) and release qualification (#575-#578) are also REQUIRED before their corresponding RC-1 capability may be claimed.

| Domaine | Point d'entrée sur `dev` | Statut | Preuve | Écart |
|---|---|---|---|---|
| Mémoire : noyau de connaissance | `unifia knowledge` (CLI), routes `/knowledge/status`, `/knowledge/search`, `/knowledge/notes/:id` | IMPLEMENTED, INTEGRATED, TESTED pour le CLI au SHA `aca300d1a0` (branche #464) | E-03 | Le CLI de `dev` lit un autre coffre tant que #464 n'est pas fusionnée |
| Mémoire : panneau | Interface, routes `/knowledge/tree`, `/note`, `/propose` | NOT_VERIFIED sur `dev` : ces routes ne sont pas sur `dev` (elles sont dans #456) | — | G-01 |
| Mémoire : E2E | `packages/app/e2e/v110/memory-*.spec.ts` | BLOCKED : le backend E2E n'a pas de mot de passe | — | G-05 |
| Mémoire : import des notes historiques | — | NOT_VERIFIED, non implémenté | — | G-06 |
| Serveur : garde d'hôte, origines, écoute | `packages/unifia/src/server/` | Fusionné (E-01). Tests rapportés au moment de la fusion, non relancés pour cette baseline | E-01 | Relancer sur `dev` avant toute qualification |
| Signature Windows | Script `script/sign-windows.ps1`, vérification `script/verify-windows-signature.ps1` | Fusionné (E-01). Tests des scripts rapportés (6 et 4), non relancés ; mode `required` non branché sur la release | E-01 | G-07 |
| Code | `packages/app/src/pages/session/code-inspector` | NOT_VERIFIED au-delà d'un test de format | — | G-10 |
| Work, Design, Team, Automate, Browser, Voice Live | Packages dédiés | NOT_VERIFIED | — | G-10 |
| Desktop | `packages/desktop` (Tauri) | NOT_VERIFIED sur `dev` pour cette baseline | — | G-09 |
| Android | `packages/mobile` | NOT_VERIFIED | — | G-08 |
