# État réel du dépôt utilisé par le rebaseline v2.0

## Branches

- `new-ui` : `2c13b7d76d0fdbec33af3952825e6bf84e930df5` — branche d'intégration fonctionnelle actuelle, non protégée au moment de l'observation.
- `work-design` : `609f2d494064c61d6688b916644560930b72cb79` — dernière promotion v110 du 17/09 ; `new-ui` est **660 commits en avance**.
- `voice` : `f3f7f03f7d167979d7a8492bdc20bb53231ace77` — diverge depuis `f269f049de...`, avec 20 commits propres et 42 commits `new-ui` non présents.
- `dev` : `95350647140a382ee6d5d61bc2f6639597d80f0b` — protégée mais ancienne.
- `main` : `207ff452b8056ae11d1f71e23198e520835f70ed` — protégée mais ancienne.

Depuis le dernier snapshot v1.5 (`9a95392a1a3c2c840edef99f7e9bf19acbf2071d`), `new-ui` a avancé de **725 commits**. Une simple continuation du task graph v1.5 créerait donc de faux travaux et de faux DONE.

## Faits structurants vérifiés dans le repo

1. `docs/audit/AUDIT-NON-CONNECTE-NEW-UI-2026-09-29.md` documente les P0/P1 de câblage et leurs corrections. Les inspecteurs/panneaux factices, la persistance Design, le run bar Automate, le graphe draft et Home ont été largement corrigés.
2. `docs/audit/AUDIT-CABLAGE-NEW-UI-2026-09-30.md` prouve que le Workbench livré injecte désormais `workflow`, mais pas encore `browser`, `desktop`, `memory`, `capabilities`, `ui`, `uiAllowedActions`, `skillHub`.
3. `scripts/package-wiring.json` classe 27 packages comme non livrés ; 17 sont des moteurs stratégiques testés mais sans consumer produit.
4. Automate dispose d'un `NativeWorkflowRuntimePort`, mais `workflow.run` n'est pas dans le bail de production, le graphe exécuté reste linéarisé et l'autorité d'un ancien run n'est pas récupérable depuis la liste.
5. Browser est suivi par #118 : le frontend v110 existe, mais service canonique, onglets, agent control, observation binding, egress/SSRF, secret scrubbing, downloads et isolation doivent être reliés.
6. Work est bloqué par #86 pour la mutation réelle du statut d'une tâche, donc le Kanban ne peut pas être réellement DnD.
7. Session a un bloqueur runtime #77 après Stop sur génération pendue.
8. Code/i18n gardent des écarts suivis par #96, #99 et #103. Memory garde #93.
9. Voice est une campagne indépendante active (#117) et sa branche a divergé de `new-ui`; elle doit être intégrée sur une base fraîche.
10. Les issues CI/sécurité/release #30, #31, #33, #54, #55, #56, #57, #58, #59 restent ouvertes et sont réintégrées au chemin critique de production.

## Nouvelle règle de preuve

**Présence de code ≠ fonction livrée.** Une capacité n'est DONE que si les cinq maillons existent :

`contrat/authority → implémentation → route/transport → consumer livré → preuve E2E/qualification`.

La vérification `scripts/check-package-wiring.mjs` devient une gate obligatoire du programme.
