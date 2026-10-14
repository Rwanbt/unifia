<!-- SPDX-License-Identifier: MIT -->
# Contrôles grisés (« bientôt ») — inventaire RC-1

**Document de travail pour #548** (gate « inventaire exhaustif des contrôles »). Décisions du propriétaire : `RC1-SCOPE.md`. Base : `origin/dev` à `b3f443a46`, le 14/10/2026.

## Décisions

1. **Fait (14/10).** Les fonctions non intégrées restent visibles, grisées et non cliquables, et sont reprises dans une prochaine release après la version 1. Elles sont rattachées zone par zone aux issues post-RC1 #675 à #682.
   - Exception par défaut : le Work (#580) reste en version 1, car `RC1-SCOPE.md` classe les actions Work `REQUIRED` (D7). Si tu veux les sortir, dis-le.
2. **À trancher.** Pour les contrôles grisés, trois manières de les rendre non cliquables :

   | Option | Ce que voit l'utilisateur | Clavier | Tests à modifier | Usage actuel |
   |---|---|---|---|---|
   | **A — `aria-disabled`** | grisé, infobulle « Bientôt » au survol | atteignable, annoncé « indisponible » | aucun | terminal, Work, studio Design, barre Automate |
   | **B — `disabled` strict** | grisé, **pas d'infobulle** sur la plupart des navigateurs | non atteignable | oui : les tests vérifiant `aria-disabled` | aucun |
   | **C — `disabled` dans un `<span title>`** | grisé, infobulle conservée | non atteignable | oui : les mêmes tests | comptes et réglages |

   **Ma recommandation : A.** C'est la convention actuelle du dépôt, et deux tests l'exigent (`automate-studio-run-bar.test.ts`, `design-studio.test.ts`). Aucune ligne de code ne change. Si tu veux qu'aucun contrôle grisé ne soit atteignable au clavier, je recommande C.

3. **#279 (Browser) : décidé et implémenté.** L'option retenue est l'hôte Node : `browser host e2e (bun -> node)` est dans la CI, livré par #593 (`af0fe2468`). Le point est retiré de la liste des décisions à prendre.

## Méthode

Un contrôle grisé est repéré par un des marqueurs suivants (`git grep` sur `packages/app/src`, hors tests, hors traductions, hors styles CSS) : `data-soon`, les composants `Soon`, `SoonAction`, `ComingSoon`, les clés `comingSoon` et `inspector.code.soon`, l'attribut `aria-disabled`, et le helper `soon(...)`.

Résultat : **72 lignes** contiennent un marqueur. Une quinzaine sont des définitions de composants ou de helpers. Les sites de rendu sont listés dans le tableau.

Le premier inventaire de ce document annonçait 44 lignes. Il était incomplet : il ne prenait ni `aria-disabled` ni le helper `soon(...)`. Ce point est corrigé ici.

Exclus :
- les sélecteurs de style (`styles/*.css`) ;
- `components/session/live-orb.tsx:103` : `aria-disabled` quand la voix est indisponible. C'est un état d'exécution, pas un contrôle « bientôt ».

## Mécanismes constatés

| Mécanisme | Où | Effet |
|---|---|---|
| `disabled` sur le contrôle, infobulle sur un conteneur | comptes, réglages, inspecteur | non cliquable, conforme |
| `aria-disabled`, sans `disabled`, sans `onClick` | terminal, Work, studio Design, barre Automate | aucune action, mais focalisable |
| `disabled` conditionnel | ajout d'appareil (réglages de calcul), entrées en attente (studio Design) | grisé seulement dans certains cas |

## Inventaire des sites de rendu

| Zone | Fichier et lignes | Mécanisme | Suite post-RC1 | Suivi RC-1 des contrôles actifs |
|---|---|---|---|---|
| Compte | `components/account/account-parts.tsx:45`, `account-personal.tsx:111, 119`, `account-security.tsx:30, 38` | `disabled` | #675 | #562 |
| Routage automatique | `components/settings-compute.tsx:57, 69, 181`, `settings-ai-preferences.tsx:64, 103, 122`, `components/status-popover-body.tsx:355` | `disabled` ; ajout d'appareil conditionnel | #676 | #560, #561 |
| Réglages | `components/settings-hooks.tsx:31, 61`, `settings-network.tsx:70, 79`, `settings-security.tsx:112`, `settings-system.tsx:225` | `disabled` | #677 | #561 |
| Observabilité | `components/settings-chat-observability.tsx:119` | `disabled` si non branché | #678 | #563 |
| Inspecteurs | `pages/session/code-inspector/context.tsx:81`, `history.tsx:46, 57, 58`, `overview.tsx:65`, `search.tsx:76`, `symbols.tsx:63`, `parts.tsx:52` ; `pages/session/mode-inspector-content.tsx:37` | `disabled` ; `aria-disabled` sans action (inspecteur de mode) | #679 | #559 (pour l'inspecteur de mode : à confirmer) |
| Terminal | `pages/session/terminal-panel-chrome.tsx:42, 47, 78, 82` | `aria-disabled`, sans `onClick` | #680 | #558 |
| Automate | `pages/workbench/automate-studio-library.tsx:128–130` ; `automate-studio-run-bar.tsx:96, 122–124, 152` | `data-soon` + `aria-disabled` ; action seulement si lançable | #681 | #555, #557 |
| Design | `pages/workbench/design/runtime/studio-panel.tsx:54, 106–108, 208, 212` ; `studio-dock.tsx:63` (entrées en attente) | `aria-disabled` + infobulle ; `disabled` conditionnel | #682 | #552 (seulement pour les régressions démontrées) |
| Work | `pages/workbench/work-cockpit.tsx:78, 79, 80, 118, 207, 224, 257` | `aria-disabled`, sans `onClick` | **#580, reste en version 1** (D7) | #580 |

## Ce que ce document ne couvre pas

- **Contrôles actifs** : leur chaîne « UI → action → API → preuve » n'est pas inventoriée.
- **Routes en 503** : non recensées.
- **`disabled` sans marqueur « bientôt »** : le code en contient des centaines, dont beaucoup sont des états temporaires (chargement, validation). Elles ne sont pas classées ici.
- **Preuve** : aucune exécution d'interface n'a été faite. La vérification repose sur la lecture du code, ligne par ligne, sur les sites de rendu.

Tant que ces trois points ne sont pas traités, **#548 reste ouvert**.
