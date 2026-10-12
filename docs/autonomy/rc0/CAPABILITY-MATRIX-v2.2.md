# Matrice de câblage — v2.2 (train de livraison par surface)

L'état observé reste celui de `v2.0-archive/CAPABILITY-MATRIX-v2.0.md` (snapshot `new-ui@2c13b7d`, à revalider par RB00). Cette table ajoute **quand** chaque capacité est livrée sur `dev` (le propriétaire décide ensuite de la promotion vers `main`). Règle : `DONE` = autorité → implémentation → transport → consommateur livré → preuve liée au SHA. Un contrôle visible est `REAL`, `EXPLICITLY_DISABLED` ou `REMOVED`.

| Surface / domaine | Train 1 (release 1 sur `dev`) | Train 2 (release 2 sur `dev`) | Train 3 (release 3 sur `dev`) |
|---|---|---|---|
| Shell / Home | Vérification de parité (UI00) | UI01/UI02 (harnais, tokens) | UI03–UI15 seulement si des slices sont OPEN |
| Chat / Session | #77, #35 | — | — |
| Code | #96 (CR08) ; i18n | Terminal Problems/Output/Tests/Debug/Ports (FX05), inspecteur de contexte (FX06) | — |
| Work / Team | #86, actions Work (CR06, FX01) | PW05 (orchestrateur) | — |
| Design | i18n (CR09) | — | Certification finale |
| Automate | `workflow.run` step-up, graphe exécuté, autorité durable (CR03–CR05) | Test/fixtures/→Work (FX02), scheduler (FX03), éditeurs de nœuds (FX04), PW09 | — |
| Browser | Masqué / « bientôt » | Ensemble BR00–BR10 + UI12, PW02, PW06, PW07 | — |
| Memory | #93 (CR07) | PW04 (gouvernance) | — |
| Settings / Compte | Contrôles sans backend masqués (FX00) | Routage IA (FX07) | Backends Compute/Réseau/Sécurité/Système/Hooks (FX08), Compte (FX09) |
| Voice | Périmètre RC-0 (VO00–VO05) | VO06 : Pocket TTS Android, AEC, STT streaming Android, endurance, Bluetooth, full-duplex | — |
| capability-runtime | PW01 (avec CR03) | — | — |
| secret-broker, browser-runtime, sandbox-drivers, computer-use-safety | — | PW02, PW06, PW07 avec Browser | — |
| memory-governance, workbench-orchestrator, scheduler, media-runtime | — | PW04, PW05, PW09 | — |
| observability | — | — | FX10, PW03 |
| artifact-store/studio, document-packs, generative-ui-dom | — | — | PW08 |
| remote-bridge, desktop-runtime | — | — | PW10 |
| Réachabilité finale des paquets | `check-package-wiring` vert | idem | PW11 |
| CI / Release | P0 (propriétaire), QA00–QA06, QA09, QA10, QA14, QA12R, RL00–RL02 (agent) ; RL03–RL07 (propriétaire) | R2 | QA11, QA12, R3 |
| Plateformes | Windows, Linux, Android (QA13) | — | Matrice complète (QA11) |
