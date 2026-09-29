# UNIFIA v2.0 — Open issue reconciliation map

> Les issues restent à revalider par RB01 : une issue ouverte peut contenir des sous-points déjà livrés. Le plan n'utilise donc jamais `OPEN = entièrement non implémenté`.

| Issue | Sujet | Lecture au rebaseline | Lots v2.0 |
|---:|---|---|---|
| #118 | Browser sessions/runtime/agent/security | chantier majeur encore pertinent | BR00-BR10, UI12 |
| #117 | Voice v2.2 G0-G14 | branche active divergente ; qualification incomplète | VO00-VO05, QA11 |
| #116 | Pixel-perfect v110 | plan historique à réconcilier avec outillage/parité déjà livré | UI00-UI15 |
| #96 | Code editor parity | partiellement dépassée (blame/diagnostics ont avancé) ; requalifier code lens/inline AI/restants | CR08, UI06 |
| #103 | Design i18n follow-up | reste à fermer mécaniquement | CR09 |
| #99 | Design i18n | sous-parties déjà corrigées ; vérifier fermeture complète avec #103 | CR09 |
| #97 | Browser v110 chrome/runtime/i18n | subsumée sans affaiblissement par #118 + certification UI | BR00-BR10, UI12 |
| #93 | Memory wikilinks rename | gap fonctionnel réel | CR07 |
| #86 | Team task status mutation | blocker réel Work Kanban | CR06, FX01 |
| #77 | Stop hanging generation deadlock | P0 runtime session | CR01, CR10 |
| #56 | Windows unit flakes | dette CI release | QA02 |
| #57 | instance-capacity LRU flake | dette déterminisme CI | QA02 |
| #54 | undeclared cross-package deps / hoisting | supply-chain/build hygiene | QA06 |
| #58 | E2E Linux slow-runner flakes | gate CI non déterministe | QA03 |
| #59 | check-duplicates pending | gouvernance required-check | QA01, QA10 |
| #55 | Turbo fail-fast masks failures | diagnostic CI | QA00 |
| #30 | CodeQL + E2E LSP production gate | security/coverage release blocker jusqu'à disposition prouvée | QA04 |
| #33 | direct dependency vulnerabilities + SDK generator contracts | dependency/security release blocker | QA05 |
| #35 | Team selector fresh install | blocker mobile/Team | CR02 |
| #31 | `unifia.ai` dangling domain | repo semble largement corrigé ; issue ne ferme qu'après scan exécutable actuel | QA07 |

## Règle de clôture

RB01 doit pour chaque issue produire l'une des dispositions suivantes : `FIX_REQUIRED`, `PARTIALLY_SUPERSEDED`, `ALREADY_FIXED_CLOSE_WITH_EVIDENCE`, `DEFER_APPROVED`, `NOT_APPLICABLE`. Aucun numéro d'issue ne doit rester uniquement comme note historique sans disposition.
