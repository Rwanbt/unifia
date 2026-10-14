<!-- SPDX-License-Identifier: MIT -->
# Contrôles grisés (« bientôt ») — inventaire RC-1

**Document de travail pour #548** (gate « inventaire exhaustif des contrôles »). Décisions du propriétaire : `RC1-SCOPE.md`, section « Décisions acquises ». Les contrôles grisés restent visibles, non cliquables tant que la fonction n'est pas implémentée et raccordée, sans mention « bientôt ».

Base : `origin/dev` à `b3f443a46`, le 14/10/2026.

## Méthode

Un contrôle grisé est signalé dans le code par un des quatre marqueurs suivants (recherche `git grep`, hors tests et hors traductions) :

- l'attribut `data-soon` ;
- le composant `<Soon>` (code inspector, Work) ou `<ComingSoon>` (terminal) ;
- la clé de traduction `comingSoon` ;
- la clé `inspector.code.soon`.

Ces marqueurs donnent **44 lignes** dans 21 fichiers TypeScript. Chaque ligne a été relue pour confirmer ce qui est désactivé. Un marqueur posé sur un conteneur (`<span title=…>`) ne compte que si le contrôle qu'il enveloppe est lui-même `disabled`.

## Mécanismes constatés

| Mécanisme | Où | Effet | Commentaire |
|---|---|---|---|
| `disabled` sur le contrôle, infobulle sur un conteneur | comptes, réglages, code inspector (`Soon`) | non cliquable | conforme à la règle |
| `aria-disabled="true"`, sans `disabled`, sans `onClick` | terminal (`ComingSoon`), Work (`Soon`) | aucune action, mais élément focalisable | **décision à confirmer** : voir plus bas |
| `disabled` conditionnel | réglages de calcul (ajout d'un appareil) | grisé seulement sans accès distant | conforme : le contrôle est actif quand la fonction existe |

## Inventaire

Les issues de rattachement sont les plus proches de l'épique #581. **Voir la question de périmètre plus bas** : elles sont dans la file RC-1.

| Zone | Fichier (lignes de rendu) | Contrôle | Mécanisme | Issue la plus proche |
|---|---|---|---|---|
| Compte | `components/account/account-parts.tsx:45` | action « SoonAction » | `disabled` | #562 |
| Compte | `components/account/account-personal.tsx:111, 119` | restauration, synchronisation | bascule `disabled` | #562 |
| Compte | `components/account/account-security.tsx:30, 38` | validation, double authentification | bascule `disabled` | #562 |
| Réglages | `components/settings-ai-preferences.tsx:64, 103, 122` | profil non manuel, préférences, routage | `disabled` | #560 |
| Réglages | `components/settings-chat-observability.tsx:119` | bascules d'observabilité | `disabled` si non branché | #563 |
| Réglages | `components/settings-compute.tsx:57, 69, 181` | carte de routage automatique, politique, ajout d'appareil | bascule `disabled` ; ajout conditionnel | #561 |
| Réglages | `components/settings-hooks.tsx:31, 61` | nouveau hook, modèles de hooks | bouton `disabled` ; liste `data-soon` | #561 |
| Réglages | `components/settings-network.tsx:70, 79` | proxy, certificats | champ et bascule `disabled` | #561 |
| Réglages | `components/settings-security.tsx:112` | verrouillage | bascule `disabled` | #561 |
| Réglages | `components/settings-system.tsx:225` | diagnostic | bouton `disabled` | #561 |
| Barre d'état | `components/status-popover-body.tsx:355` | routage automatique | ligne `disabled` | #561 |
| Code inspector | `pages/session/code-inspector/parts.tsx:52` | composant `Soon` | `disabled` (utilisé ci-dessous) | #559 |
| Code inspector | `…/context.tsx:81` | ajout de contexte | `Soon` disabled | #559 |
| Code inspector | `…/history.tsx:46, 57, 58` | point de contrôle, comparer, branche | `Soon` disabled | #559 |
| Code inspector | `…/overview.tsx:65` | bouton | `disabled` | #559 |
| Code inspector | `…/search.tsx:76` | éléments liés | `Soon` disabled | #559 |
| Code inspector | `…/symbols.tsx:63` | symboles | `Soon` disabled | #559 |
| Terminal | `pages/session/terminal-panel-chrome.tsx:42, 47, 78, 82` | problèmes, sorties, tests, debug, ports, diviser, agent | **`aria-disabled`** | #558 |
| Automate | `pages/workbench/automate-studio-library.tsx:128–130` | entrées de bibliothèque non lançables | `data-soon` + `aria-disabled` ; action seulement si lançable | #557 |
| Work | `pages/workbench/work-cockpit.tsx:78, 79, 80, 118, 207, 224, 257` | sélection automatique, plan IA, annuler, lancer, politique, approuver | **`aria-disabled`** | #580 |

Les occurrences dans `styles/*.css` sont des sélecteurs de style, pas des contrôles : elles ne sont pas comptées.

## Décisions à prendre

1. **Rattachement en file RC-1.** Les issues ci-dessus (#557 à #563, #580) font partie de la file de #581, qui est la release 1. Or le propriétaire a décidé que les fonctions « bientôt » ne sont pas dans la release 1 et doivent avoir une issue pour la suite. Il faut choisir : créer une issue « post-RC1 » par zone (environ huit), ou garder ce rattachement et sortir ces fonctions de la release 1. **Je ne crée rien sans ta réponse.**
2. **`aria-disabled` ou `disabled`** pour le terminal et le Work. Les deux bloquent toute action. `aria-disabled` garde l'infobulle visible, `disabled` la supprime. Je recommande de garder `aria-disabled`, sans `onClick`, et de documenter ce choix dans le code.

## Ce que ce document ne couvre pas

- **Contrôles actifs** : leur chaîne « UI → action → API → preuve » n'est pas inventoriée.
- **Routes en 503** : non recensées.
- **`disabled` sans marqueur « bientôt »** : le code contient des centaines de lignes avec `disabled`, dont beaucoup sont des états temporaires (chargement, validation). Elles ne sont pas classées ici.
- **Preuve** : aucune exécution d'interface n'a été faite. La vérification repose sur la lecture du code.

Tant que ces trois points ne sont pas traités, **#548 reste ouvert**.
