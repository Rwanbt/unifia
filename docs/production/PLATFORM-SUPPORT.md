<!-- SPDX-License-Identifier: MIT -->
# Support des plateformes

Ce qui est vérifié, par plateforme, au SHA `2d2e2146c9` (`dev`).

| Plateforme | Build dans la CI | Tests dans la CI | Preuve sur appareil ou runtime réel | Statut |
|---|---|---|---|---|
| Linux (CI) | `typecheck`, `web-build`, `nix-eval` | `unit (linux)`, `rust unit tests`, `e2e (linux)` (non requis sur `dev`) | Runs de #464 : `unit (linux)` vert sur `aca300d1a0` (E-06) | TESTED en CI |
| Windows (CI) | Non vérifié | `unit (windows)` | Runs de #464 : en cours au moment de la baseline ; échec précédent sur `448ae70dd1` (E-05) | TESTED en CI, en attente de confirmation |
| Windows (desktop, Tauri, NSIS) | Non vérifié sur `dev` | Non | Non | NOT_VERIFIED. SignTool non reproduit (G-07) |
| Windows (vérification de signature) | `.github/workflows/release.yml` étape « Verify Windows installer signature state » (optionnelle) | `scripts/verify-windows-signature.test.mjs` (rapporté) | Non | IMPLEMENTED, mode `required` non branché |
| Android | Non vérifié | Non | Non | NOT_VERIFIED. Chaîne non reproductible (G-08) |
| Web (interface servie par `unifia web`) | `web-build` | Non | Non | Build vert ; pas d'essai dans un navigateur pour cette baseline |
| macOS | Non vérifié | Non | Non | NOT_VERIFIED |

## Ce que ce tableau n'affirme pas

- Aucun binaire n'a été exécuté sur une plateforme physique pour cette baseline.
- Un job vert en CI ne prouve pas le comportement de la plateforme au-delà des tests qu'il exécute.
