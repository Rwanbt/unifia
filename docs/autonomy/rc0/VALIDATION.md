# Validation mécanique — v2.2

- Tâches : **104** (train 1 : 53, train 2 : 28, train 3 : 23)
- Tailles : {'S': 6, 'L': 46, 'M': 21, 'XL': 31}

## Contrôles

- PASS — IDs uniques : 104/104
- PASS — Dépendances manquantes : 0
- PASS — Acyclique (Kahn) : 104/104 tâches ordonnées
- PASS — Aucune dépendance vers un train ultérieur : 0
- PASS — Racine unique RB00 : RB00
- PASS — Tâches owner_only : RL03, RL04, RL05, RL06, RL07, P0
- PASS — Tâches de code du train 1 dépendent de P0 : 18 tâches
- PASS — Chaque issue de ISSUE-MAP-v2.2 est reliée à au moins une tâche : carte 20 · graphe 20 · absentes : []
- PASS — Cartes citées dans le prompt existent : CARD-CR03.md, CARD-DOC01.md, CARD-P0-OWNER.md, CARD-QA14.md, CARD-RB00.md, CARD-RB01.md, CARD-RB02.md, CARD-RB03.md, CARD-VO00.md
- PASS — Aucun vestige de « beta.1/beta.2 » ou de canal beta à créer : 0

## Ce que cette validation ne prouve pas

Elle vérifie la structure du graphe et la cohérence des fichiers du pack. Elle ne certifie ni l'état du dépôt, ni les statuts d'issues GitHub (non revalidés), ni les estimations de délai.
