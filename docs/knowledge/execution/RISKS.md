# RISKS — Sovereign Knowledge Core V1

> Registre des risques actifs. Format : ID · date · description · sévérité
> (Critical/High/Medium/Low) · mitigation · owner. Append-only.

---

## R-0001 — Scope >> budget d'une seule session

- **Sévérité** : High (organisationnel)
- **Description** : 13 phases, ~50 cartes, ~20 M tokens source, device
  Android non disponible dans la session courante. Tout passage "PASS"
  sans preuve viole le runbook.
- **Mitigation** : exécution par cartes avec preuves ; à chaque checkpoint
  documenter dans `STATE.md` la prochaine carte ; pas de "PASS hypothétique".
- **Owner** : orchestrateur session.

## R-0002 — Bun version drift (1.3.14 vs 1.3.11 déclaré)

- **Sévérité** : Low
- **Description** : le repo épingle bun@1.3.11 dans `bun.lock` ; la machine
  installe 1.3.14. Le risque est mineur tant que `bun.lock` est respecté
  par le binaire, ce qui est le cas pour des versions compatibles 1.3.x.
- **Mitigation** : garder `bun.lock` source de vérité ; ne pas régénérer
  le lockfile ; signaler toute régression.
- **Owner** : session.

## R-0003 — Pas de device Android

- **Sévérité** : Medium
- **Description** : Phase 10 (Android) requiert idéalement un device.
  Sans device, certains gates (P10.2 chaîne réelle) restent
  `NOT_EXECUTED_EXTERNAL_BOUNDARY`.
- **Mitigation** : compiler, tester en local, marquer la frontière,
  continuer les autres phases ; consigner l'artefact installable.
- **Owner** : session.

## R-0004 — Pas de modèle d'embedding téléchargé

- **Sévérité** : Medium
- **Description** : Phase 5 (sémantique) requiert un modèle ONNX
  téléchargeable. Sans téléchargement autorisé, capability = `disabled`.
- **Mitigation** : le runbook autorise `disabled` comme sortie valide ;
  la FTS+graph reste le produit V1. Documenter la désactivation dans
  `STATE.md` et `DECISIONS.md`.
- **Owner** : session.

## R-0005 — Réseau potentiellement instable

- **Sévérité** : Low
- **Description** : opérations `git fetch origin dev`, `cargo fetch`,
  `bun install` peuvent échouer. Une erreur réseau n'est pas un PASS.
- **Mitigation** : retry borné (3 fois), puis `UNVERIFIED_ENVIRONMENT`
  dans `blockers/` et continuer.
- **Owner** : session.

## R-0006 — Périmètre knowledge/ croise des packages existants (memory-governance, etc.)

- **Sévérité** : High (architecture)
- **Description** : `packages/memory-governance/`, `packages/memory-runtime/`,
  ADR 0018 (memory system) pré-existent. Le plan prévoit un namespace
  `knowledge/` qui peut entrer en conflit.
- **Mitigation** : Phase 0 inventaire l'existant ; ADR de coexistence ;
  contrats `@unifia/contracts/knowledge/` ajoutés sans casser les exports
  actuels ; tests de non-régression sur les packages existants.
- **Owner** : session.

## R-0007 — 50 ADR pré-existants non lus exhaustivement

- **Sévérité** : Medium
- **Description** : `docs/adr/0001..1032` existe. Tous ne sont pas lus
  dans cette session. Risque de réinventer une décision déjà actée.
- **Mitigation** : Phase 0.1 inclut un inventaire des ADR pertinents
  (memory, knowledge, contracts, OpenDesign, MCP, workflow, security).
  Au moins les ADR `0017` (OpenDesign), `0018` (memory system), `0019`
  (workflow automation), `0020` (MCP UI server), `0021` (spec-driven),
  `0028` (contracts implementation), `1026` (export boundary),
  `1027` (local install secret), `1028` (local auth ownership),
  `1029` (queue ordering), `1030` (migration rollback) doivent être
  relus avant toute décision de scope.
- **Owner** : session.
