<!-- SPDX-License-Identifier: MIT -->
# CR04 — diagnostic e2e Automate (2026-09-30)

Statut : **bloqué avant preuve de bout en bout ; aucun correctif ni test rouge conservé**.

## Mesures

- Le scénario local visait le parcours browser « créer les nœuds, configurer `control.if`/`control.merge`, dessiner les arêtes, lancer ».
- Trois exécutions ciblées de `packages/app/e2e/v110/automate-branch-run.spec.ts` se sont arrêtées avant la première interaction : `[data-workbench-surface="automate"]` restait absent et la capture montrait une page blanche.
- Le troisième essai instrumenté a relevé trois `net::ERR_INSUFFICIENT_RESOURCES`, sans `pageerror` applicatif.
- Le témoin existant `automate-responsive.spec.ts` a monté la surface et passé ses étapes desktop/tablette/téléphone ; il a ensuite expiré sur `compact-landscape-844x390`, où le bouton Nodes est intercepté par le panneau de session en transition.
- L’échec du témoin est préexistant au lot et ne prouve pas la cause de la page blanche du nouveau scénario.
- Le premier lancement sandboxé a échoué avec `spawn EPERM`; l’exécution autorisée a démarré Vite et Chromium. Le warning Vite `@tsconfig/bun/tsconfig.json` manquant était également présent sur le témoin.

## Cause racine

Non établie. Les données disponibles ne permettent pas de distinguer un épuisement de ressources du navigateur local d’une course entre le deep link `/automate`, la connexion du Workbench et le montage de la surface. Aucun changement produit n’est justifié.

## Pistes de reprise

1. Instrumenter le bootstrap du navigateur (`pageerror`, `requestfailed` avec URL, statut HTTP, DOM après navigation) et prouver que la connexion a accordé `workflow.run` avant d’évaluer le deep link.
2. Refaire le parcours à partir d’une session stable puis sélectionner Automate depuis le rail, comme le fait le shell, afin de séparer le routage froid du flux UI.
3. Si la capacité du mock limite le test, utiliser un client Workbench de test connecté au runtime local et vérifier que la définition dessinée atteint le vrai endpoint `/v1/workflows/start` avant d’asserter l’exécution de branche.

Ne pas relancer le même scénario sans nouvel instrument ou changement d’environnement : trois essais ont atteint le même point d’arrêt.
