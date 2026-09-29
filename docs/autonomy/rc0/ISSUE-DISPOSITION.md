<!-- SPDX-License-Identifier: MIT -->
# ISSUE-DISPOSITION — issues ouvertes au 2026-09-29 (carte RB01, partie 1)

Dispositions **proposées** (aucune issue n'a été fermée, commentée ni créée). Preuve = commande `git log origin/new-ui --grep="#N"` sauf mention. 20 issues ouvertes (`gh issue list --state open`).

| # | Disposition proposée | Preuve / remarque | Tâche | Train |
|--:|---|---|---|:-:|
| 77 | FIX_REQUIRED | seul un test e2e de parcours (cc6d68d) mentionne Stop ; blocage après Stop non prouvé corrigé | CR01, CR10 | 1 |
| 35 | FIX_REQUIRED | aucun commit ne référence #35 | CR02 | 1 |
| 86 | FIX_REQUIRED | portage v110 Work (#100) ne crée pas la mutation HTTP de statut de tâche | CR06, FX01 | 1 |
| 93 | PARTIALLY_SUPERSEDED | 20cf941 « rename refactors unambiguous wikilinks on real files (#93) » ; cas ambigus/vérif à faire par CR07 | CR07 | 1 |
| 96 | PARTIALLY_SUPERSEDED | 64eaade « git blame annotations (#96 slice 2) » livré ; code lens, IA inline, marqueurs de diagnostic restent | CR08 | 1 |
| 99 | PARTIALLY_SUPERSEDED | b4a0712 élargit le garde i18n ; docs `8eef257` notent un trou de couverture | CR09 | 1 |
| 103 | FIX_REQUIRED | suivi de #99 (Design artifact/surface/toolbar) | CR09 | 1 |
| 97 | FIX_REQUIRED | `01987686` note que le runtime Browser manque | BR00–BR10, UI12 | 2 |
| 118 | FIX_REQUIRED | Browser sessions/agent/sécurité ; hors train 1 | BR00–BR10 | 2 |
| 117 | FIX_REQUIRED | Voice v2.2 ; branche `voice` non intégrée (VOICE-DIVERGENCE.md) | VO00–VO05, VO06 | 1 puis 2 |
| 116 | PARTIALLY_SUPERSEDED | campagne v110 promue (609f2d4) ; slices OPEN à vérifier en UI00 | UI00–UI15 | 1 puis 3 |
| 55 | FIX_REQUIRED | fail-fast Turbo ; non revérifié | QA00 | 1 |
| 56 / 57 | FIX_REQUIRED | flakes ; RB03 : `unit` non stabilisé (23 échecs locaux à classer) | QA02 | 1 |
| 58 | FIX_REQUIRED | flakes e2e | QA03 | 1 |
| 59 | FIX_REQUIRED | check-duplicates jamais rapporté (observé « pending » sur PR #119) | QA01, QA10 | 1 |
| 54 | FIX_REQUIRED | dépendances non déclarées ; `a6195bf` en a déclaré une partie → PARTIALLY à vérifier | QA06 | 1 |
| 33 | PARTIALLY_SUPERSEDED | `a6195bf` « patch the critical and high advisories » ; le générateur SDK/2 violations de contrat restent à vérifier | QA05 | 1 |
| 31 | FIX_REQUIRED | domaine unifia.ai ; non revérifié | QA07 | 1 |
| 30 | FIX_REQUIRED | gate CodeQL/E2E LSP ; non revérifié | QA04 | 1 |

Aucune issue dispositionnée `ALREADY_FIXED_CLOSE_WITH_EVIDENCE`. Les statuts « PARTIALLY » sont à confirmer par la tâche qui porte le correctif ; ce n'est jamais une lecture « OPEN = non implémenté ».
