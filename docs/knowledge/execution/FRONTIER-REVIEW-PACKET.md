# FRONTIER-REVIEW-PACKET — Sovereign Knowledge Core V1

> Paquet de revue frontier, construit uniquement à la fin de Phase 11
> (runbook §24). Sections vides à ce stade, à remplir carte par carte
> au cours de l'exécution.

## Sections à remplir

- [ ] Baseline et HEAD final
- [ ] Architecture (résumé)
- [ ] Fichiers ajoutés/modifiés
- [ ] Contrats publics (`@unifia/contracts/knowledge/`)
- [ ] Call sites principaux
- [ ] Migrations et rollback
- [ ] Modèle de sécurité (authority, egress, sandbox, declassification)
- [ ] Tests et benchmarks
- [ ] Artefacts avec hashes
- [ ] Limitations connues
- [ ] Coverage (fichiers, modules, lignes)
- [ ] Frontières externes (Android device, embedding model, MCP remote)
- [ ] Commandes de reproduction

## Prompt reviewer (runbook §24.3)

> Tu es le reviewer frontier indépendant final du Sovereign Knowledge
> Core V1. Effectue une revue read-only du diff complet et des preuves.
> Vérifie correction, sécurité, authority/egress, filesystem/path
> containment, crash recovery, concurrence, ressources, migrations,
> portability, Android, performance, tests, producer/consumer
> consistency et conformité au plan gelé. Ne propose aucun
> élargissement spéculatif du scope. Chaque finding doit contenir
> sévérité, fichier/ligne, scénario reproductible, impact V1 et
> correctif vérifiable. Statuts autorisés : ACCEPTED, FIXED,
> REJECTED_WITH_EVIDENCE, REJECTED_AS_SPECULATIVE, DEFERRED_OUT_OF_SCOPE.
> Le gate final exige 0 Critical et 0 High accepté non résolu.
