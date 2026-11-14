# MEI — Matrice de lots / réalisation

> Les codes sont stables et correspondent au plan v4, **amendé par v4.1**. La hiérarchie détaillée et les tickets ont pour autorité l'epic #1148. Aucune tâche P0/A1 n'est exécutable tant que les gates et arbitrages correspondants ne sont pas valides.

| Gate | Travail couvert | Dépendances | Gate de sortie |
|---|---|---|---|
| P-1 | P-1.1–P-1.7 : état dev, décisions, migration legacy, baseline, POC JNI, revue Fable, cartographie des spawners | owner + #597 | conflits et inconnues tracés; owner ownership décidé |
| P0 | P0-01–09 + **P0-04b** gestion clé + **P0-10** scheduler minimal | P-1, ADR-MEI-03/04/16 | secure default + flag-off non régressif; VRAM unknown => 1 instance |
| A1 | A1-01–08, mais **A1-03 une instance gérée** | P0 + ADR-MEI-16 | install/use/uninstall upstream+Prism desktop, port+leases; pas d'affirmation multi-instance |
| C1 | C1-01–08 avec **C1-05 premier multi-instance** | A1, P0-10 | compat Q2/PQ2, parameters, probes, resource and perf evidence |
| D1 | D1-01–07 lifecycle, rollback, GC, packaging | C1 | transactions et récupération multi-OS sans régressions sécurité |
| B | B-01–07 Python/venv, container, moteurs supplémentaires | A1 et D1 selon risque | au moins une autre famille qualifiée |
| E | E-01–07 modules Android et service durable | P-1.5 + P0 + A1 contract | arm64 natif qualifié; Prism JNI conditionnel |
| F | F-01–06 preuves, E2E, doc, review, release gate | tous gates pertinents | owner GO/NO-GO explicite |

## Dépendances structurantes de v4.1

- **P-1.7** doit cartographier Bun+Rust spawn / owner-ref-lock avant ADR-MEI-16.
- **P-1.2** doit arbitrer GPU obligatoire `CLAUDE.md` vs backend CPU en catalogue; ne pas supprimer CPU du schéma sans owner.
- **P0-04b** définit root key offline, sauvegarde, rotation, compromission et signature owner-only.
- **P0-10** refuse admission si poids+KV+marge dépassent le budget connu; **unknown = une instance max**.
- **A1-03** lance une seule instance gérée; services `external-managed` restent connectables; plusieurs ports/instances seulement à **C1-05**.
- **E-03** doit reconstruire leases/état de manière durable au retour du sidecar Bun Android.
- SHA-256 LFS modèle obligatoire pour chaque entrée de catalogue recommandée; import utilisateur = unverified.

## Gates de sécurité P0 (bloquants)

Signer index et manifests; key pinned; reject rollback et revocation connue; hash+size avant exécution; anti ZIP-slip / symlink / redirections host SSRF; allowlist typée de flags et paths; aucune exécution shell arbitraire, bind local, consentement serveur; séparation egress/provenance; tests sur routes existantes; legacy flag-off.

## Revue et preuve

Pour chaque PR : ID MEI, source de décision, SHA du code, SHA/URI des binaires, OS/arch/GPU/driver, tests PASS/FAIL/NOT RUN, stratégie de rollback, risque d'egress et données. Pas de tests désactivés pour obtenir vert; pas de claim mobile/desktop sans appareils physiques.
