# Vérifications manuelles restantes

Cette liste est la source de vérité des contrôles qui nécessitent une machine, un appareil, une interaction UI ou une décision humaine. Aucun item ne doit être marqué `PASS` sur une simple compilation.

| ID | Gate | Procédure | Preuve attendue | Statut |
|---|---|---|---|---|
| MV-01 | Bridge natif desktop | Construire le profil debug, lancer l’application Tauri et ouvrir un mode Work avec un workspace réel. Observer l’appel natif qui fournit le jeton court ; vérifier qu’aucun secret maître n’est présent dans le JS, le local storage, l’URL ou les logs. | Capture des appels/console filtrée + chemin du build + résultat d’inspection du stockage. | `PENDING` |
| MV-02 | Rotation desktop | Maintenir un flux SSE ouvert, déclencher la rotation du jeton, vérifier l’état `rotating`, la mise en attente des sorties, l’acceptation temporaire de l’ancien jeton puis son refus après la grace period. | Trace horodatée : ancien/nouveau jeton redacted, événements de rotation, requête après expiration refusée. | `PENDING` |
| MV-03 | Android runtime | Installer le build debug Android sur un appareil identifié, ouvrir Work puis Design, revenir en arrière-plan et au premier plan. Vérifier l’absence de second runtime et la reprise du flux. | `adb` package/version, `lastUpdateTime`, captures des deux modes, trace de reprise. Un candidat unsigned a été généré le 2026-08-14 ; installation et observation restent à faire. | `PENDING` |
| MV-04 | Android SVG inert | Dans le WebView Android réel, charger un SVG via `<img src="data:…">` contenant un texte, un token de couleur et une tentative de script/ressource externe. Vérifier rendu, inertie et absence de requête externe. | Capture écran + log réseau/WebView ; le script et la ressource externe ne s’exécutent pas. | `PENDING` |
| MV-05 | Mobile write safety | Depuis Android, tenter une écriture Work/Design avec un compte de test et vérifier le refus par défaut ; vérifier qu’une approbation explicite seule permet l’action prévue. | Requête, statut, écran d’approbation, audit redacted. | `PENDING` |
| MV-06 | Navigation UI | Tester le rail Code/Work/Design/Automate, les deep links et le mode persistant après fermeture/réouverture pour deux répertoires distincts. | Matrice chemin → mode affiché, captures et absence de requête réseau sur le changement de mode. | `PENDING` |
| MV-07 | Crash/restart | Arrêter brutalement le service local pendant une session, relancer l’application, vérifier l’identité d’instance, la reprise du workspace et l’absence de contamination d’un ancien worktree. | Logs de deux instances, workspace IDs, résultat de reprise et absence de trace orpheline. | `PENDING` |
| MV-08 | Port et single-writer | Lancer deux instances sur le port configuré, puis avec port automatique ; vérifier qu’une seule devient propriétaire et que l’autre échoue proprement. | Sortie des deux processus, port effectivement lié, erreur attendue et arrêt propre. | `PENDING` |
| MV-09 | CSP | Vérifier dans les builds desktop et Android que `connect-src` autorise uniquement les origines prévues pour le bridge et le loopback, que `img-src` accepte `data:`, et que `object-src`/frames restent bloqués. | Garde statique `scripts/check-workbench-security.mjs` PASS ; CSP extraite des bundles empaquetés et test manuel des URLs autorisées/interdites restent requis. | `PENDING` |
| MV-10 | Publication gate | Avant toute PR/merge, relire la checklist, inspecter le diff, vérifier licences/SPDX, migrations/rollback et confirmer explicitement qu’aucune publication n’est demandée. | Validation humaine signée dans le checkpoint ; aucun push/merge automatique. | `PENDING` |

## Règle de mise à jour

- `PENDING` → `PASS` uniquement avec la preuve décrite.
- `PENDING` → `BLOCKED` si l’environnement ou l’autorisation manque ; noter la cause et ne pas contourner.
- Les secrets, certificats, tokens et captures doivent être redacted avant archivage.
