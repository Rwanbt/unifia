<!-- SPDX-License-Identifier: MIT -->
# Matrice des capacités

## Périmètre RC-1 (proposition à ratifier — #548)

Voir [RC1-SCOPE.md](RC1-SCOPE.md) : `REQUIRED`, `DEFERRED_HIDDEN`,
`DISABLED_VISIBLE`, `NOT_IN_RC1` décrivent la **politique de release** ;
les statuts ci-dessous décrivent séparément la **preuve d'intégration**.
`REQUIRED` n'implique jamais `INTEGRATED` ni `GA_READY`.

| Capacité RC-1 | Politique | Écart / suivi | Preuve livrée |
|---|---|---|---|
| Browser (UI) | `DEFERRED_HIDDEN` (D2) | #118 #279 #554 ; fondations possibles | Aucune livraison RC-1 revendiquée |
| Voice bornée | `REQUIRED` (D3) | #117 | Qualification physique + CI attendues |
| Windows / Linux / Android | `REQUIRED` (D5) | #575 #576 | Matrice plateforme / installation attendue |
| macOS / iOS / Web-PWA | `NOT_IN_RC1` (D5) | #575 #598 | Exclusion explicite, sans preuve produit |
| Parité Design | `REQUIRED` (D6, corrections observées uniquement) | #552 ; PR #583 | Gate visuel encore à qualifier |
| `home.glance` / onglets de workspace / `code.diff` | `REQUIRED`, écarts non livrés | #550 #551 #588 ; PR #590–#592 fermées sans fusion | E2E et décision finale attendus |
| Code Lens / Inline AI | `NOT_IN_RC1` **proposé** | #96, arbitrage propriétaire attendu | Indisponibilité déclarée, pas d'effet factice |
| Contrôles « SOON » | `DISABLED_VISIBLE` | #548, inventaire à compléter | Contrôle désactivé à démontrer |

La matrice historique qui suit **n'est pas actualisée automatiquement** par
cette proposition ; ses SHAs et constats ne valent pas preuve sur le prochain
head de PR. Les éventuels statuts contradictoires sont ouverts pour revue.

Statuts : `IMPLEMENTED` (code présent), `INTEGRATED` (atteignable depuis le point d'entrée distribué), `TESTED` (exécuté par un test au SHA cité), `E2E_CERTIFIED`, `GA_READY`, `BLOCKED`, `NOT_VERIFIED`. Un statut plus haut exige les statuts plus bas.

Les statuts sont ceux de `dev` à `2d2e2146c9`, sauf mention contraire. « Point d'entrée » = ce que l'utilisateur ou le CLI atteint réellement.

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
