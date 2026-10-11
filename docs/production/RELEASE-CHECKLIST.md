<!-- SPDX-License-Identifier: MIT -->
# Checklist de release candidate

Aucune release n'est publiée sans autorisation explicite. Cette checklist décrit ce qu'une candidate doit prouver. Chaque ligne porte son état à la date de la baseline.

| # | Exigence | État | Référence |
|---|---|---|---|
| 1 | Candidate construite depuis un SHA identifié de `dev` | NOT_VERIFIED : aucune candidate n'a été construite | BASELINE |
| 2 | Tous les contextes requis verts sur ce SHA | Partiel : `unit (linux)` vert sur une PR, `unit (windows)` en attente | EVIDENCE-INDEX E-06 |
| 3 | Suites unitaires et d'intégration exécutées, non seulement découvertes | NOT_VERIFIED sur `dev` pour cette baseline | TEST-INVENTORY (comptage seulement) |
| 4 | E2E navigateur de la mémoire verts | BLOCKED (G-05) | GAP-REGISTER |
| 5 | Signature Windows : mode `required` branché sur le pipeline de publication signé | BLOCKED (G-07) | GAP-REGISTER |
| 6 | Vérification de signature : format, validité, chaîne, identité attendue | IMPLEMENTED (#462), non exécutée sur un artefact réel | PLATFORM-SUPPORT |
| 7 | Candidate Windows isolée et reproductible | NOT_VERIFIED (G-09) | GAP-REGISTER |
| 8 | Chaîne Android reproductible : empreintes, provenance, APK de développement vérifié | NOT_VERIFIED (G-08) | GAP-REGISTER |
| 9 | Vault : lint vert avant tout export de notes | BLOCKED (G-02) | GAP-REGISTER |
| 10 | Migrations et rollback vérifiés | NOT_VERIFIED | — |
| 11 | SBOM, licences, checksums des artefacts | NOT_VERIFIED | — |
| 12 | Rapport GO/NO-GO rattaché à un SHA | À rédiger quand 1 à 11 sont renseignés | — |
| 13 | Promotion vers `main` | Interdite sans autorisation explicite du propriétaire | — |

## Verdict courant

NO-GO. Les exigences 1, 3, 4, 5, 7, 8, 10, 11 ne sont pas démontrées. La mission est en phase A.
