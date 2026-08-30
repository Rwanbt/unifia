<!-- SPDX-License-Identifier: MIT -->
# RISKS — Sovereign Knowledge Core V1

> Registre des risques actifs. Format : ID · date · description · severite
> (Critical/High/Medium/Low) · mitigation · owner. Append-only.

---

## R-0001 — Scope >> budget d'une seule session

- **Severite** : High (organisationnel)
- **Description** : 13 phases, ~106 cartes, ~300 fichiers source,
  device Android parfois non disponible dans la session courante.
  Tout passage "PASS" sans preuve viole le runbook.
- **Mitigation** : execution par cartes avec preuves ; a chaque
  checkpoint documenter dans `STATE.md` la prochaine carte ; pas
  de "PASS hypothetique".
- **Owner** : orchestrateur session.
- **Statut** : **CLOSED** (104/106 cartes executees a HEAD bdb123a18e ;
  2/106 en `PASS_WITH_SAFE_FALLBACK` — P10.2 et P10.3).

## R-0002 — Bun version drift (1.3.14 vs 1.3.11 declare)

- **Severite** : Low
- **Description** : le repo epingle bun@1.3.11 dans `bun.lock` ; la
  machine installe 1.3.14. Le risque est mineur tant que `bun.lock`
  est respecte par le binaire, ce qui est le cas pour des versions
  compatibles 1.3.x.
- **Mitigation** : garder `bun.lock` source de verite ; ne pas
  regenerer le lockfile ; signaler toute regression.
- **Owner** : session.
- **Statut** : **OPEN** (mineur, en attente de clarification upstream).

## R-0003 — Pas de device Android (partiellement leve)

- **Severite** : Medium
- **Description** : Phase 10 (Android) requiert un device. Sans
  device, certains gates (P10.2 chaine reelle) restent
  `PASS_WITH_SAFE_FALLBACK`.
- **Mitigation** : Xiaomi Mi 10 Pro (cmi_eea) connecte en
  fin de session 12 ; probe executable (adb, app installed,
  app running, fs writable, deep-link works) ; full chain
  necessite APK rebuild avec `rootfs.tgz` integre
  (`bun --cwd packages/mobile build:android`, 30-60 min).
- **Owner** : operateur.
- **Statut** : **OPEN** (en attente de decision operateur pour
  rebuild APK).

## R-0004 — Pas de modele d'embedding telecharge

- **Severite** : Medium
- **Description** : Phase 5 (semantique) requiert un modele ONNX
  telechargeable. Sans telechargement autorise, capability =
  `disabled`.
- **Mitigation** : le runbook autorise `disabled` comme sortie
  valide ; la FTS+graph reste le produit V1. P5.5 utilise un
  fake embed deterministe (4-dim, byte-mixed) pour les tests.
  Documenter la desactivation dans `STATE.md` et `DECISIONS.md`.
- **Owner** : session.
- **Statut** : **OPEN** (V1 delivre, extension V1.1 si necessaire).

## R-0005 — Reseau potentiellement instable

- **Severite** : Low
- **Description** : operations `git fetch origin dev`, `cargo fetch`,
  `bun install` peuvent echouer. Une erreur reseau n'est pas un PASS.
- **Mitigation** : retry borne (3 fois), puis `UNVERIFIED_ENVIRONMENT`
  dans `blockers/` et continuer.
- **Owner** : session.
- **Statut** : **CLOSED** (aucune operation reseau requise pour V1
  en mode `offline-first` ; le cas ne s'est pas presente).

## R-0006 — Perimetre knowledge/ croise des packages existants

- **Severite** : High (architecture)
- **Description** : `packages/memory-governance/`, `packages/memory-runtime/`,
  ADR 0018 (memory system) pre-existent. Le plan prevoit un namespace
  `knowledge/` qui peut entrer en conflit.
- **Mitigation** : Phase 0 inventaire l'existant ; ADR de coexistence ;
  contrats `@unifia/contracts/knowledge/` ajoutes sans casser les
  exports actuels ; tests de non-regression sur les packages existants.
- **Owner** : session.
- **Statut** : **CLOSED** (zero conflit detecte ; les imports entre
  `knowledge` et `memory-*` sont separes par namespace).

## R-0007 — 50 ADR pre-existants non lus exhaustivement

- **Severite** : Medium
- **Description** : `docs/adr/0001..1032` existe. Tous ne sont pas
  lus dans cette session. Risque de reinventer une decision deja
  actee.
- **Mitigation** : Phase 0.1 inclut un inventaire des ADR pertinents
  (memory, knowledge, contracts, OpenDesign, MCP, workflow, security).
- **Owner** : session.
- **Statut** : **CLOSED** (ADR 0017, 0018, 0019, 0020, 0021, 0028,
  1026, 1027, 1028, 1029, 1030 relus ; voir `STATE.md` P0.1).

## R-0008 — BruteForceIndex O(n) par query

- **Severite** : Low (performance)
- **Description** : `BruteForceIndex` est O(n) par query. Si un
  vault depasse 50k notes, le defer-ANN (ADR-KNOW-0008 §3) sera
  declenche.
- **Mitigation** : bench-large (100 notes x 256 chunks) vert ;
  vecteur d'indexation ANN deferred jusqu'a preuve de besoin.
- **Owner** : session.
- **Statut** : **OPEN** (a surveiller au-dela de 50k notes).

## R-0009 — `mavis-trash` policy Windows-specifique

- **Severite** : Low
- **Description** : `mavis-trash` (recoverable delete) est
  Windows-specifique ; portabilite macOS/Linux repose sur
  PowerShell-Core UTF-8 detection.
- **Mitigation** : cf. gotcha 2026-08-24 memory tail ; alternative
  est `os.remove` / `shutil.rmtree` Python.
- **Owner** : session.
- **Statut** : **OPEN** (mineur, documente).

## R-0010 — TypeScript `useDefineForClassFields` shadow edge cases

- **Severite** : Low
- **Description** : field prive et method public de meme nom sous
  ce mode strict peuvent shadow (cf. P11 events/bus). Tests ne
  couvrent pas systematiquement ce cas.
- **Mitigation** : naming discipline (fields en `#evts`, methods
  en `events()`) ; ajouter biome + tsc strict progressif.
- **Owner** : session.
- **Statut** : **OPEN** (documente en MEMORY, a surveiller).

## R-0011 — Frontier review non declenchee

- **Severite** : Medium
- **Description** : packet pret (`FRONTIER-REVIEW-PACKET.md`,
  14 318 bytes) mais aucun modele frontier externe n'a ete
  sollicite. Risque : decisions architecturales non challengees.
- **Mitigation** : presenter le packet a Claude Opus / GPT-5 /
  Gemini 2.x Pro ; integrer le feedback dans V1.1 ou V2.
- **Owner** : operateur.
- **Statut** : **OPEN** (en attente de presentation externe).

## R-0012 — Parties d'ADR-KNOW-0006 non implémentées

**Sévérité** : haute (sécurité, latente)
**Statut** : OUVERT
**Ouvert le** : 2026-08-29, après la contre-revue frontier

La contre-revue a établi que le mécanisme central d'ADR-KNOW-0006 n'était pas
implémenté, et qu'aucun risque ne le suivait — c'était le plus grand écart de
périmètre V1 et le seul absent du registre.

La remédiation a livré les règles 1, 2 et 4 (restrictions portables
exprimables et appliquées, UNCLASSIFIED refusé vers l'externe, override qui ne
peut que restreindre). **Restent non implémentées** :

- **§3 `DeclassificationGrant`** — aucun mécanisme one-shot lié au hash, à la
  destination et à un TTL. Conséquence : rien ne peut légitimement élargir un
  `deny` en V1, ce qui est fail-closed mais bloque le cas d'usage documenté
  du partage explicite consenti.
- **§3 héritage** — `mostRestrictive()` existe et est testé, mais aucun
  pipeline de transformation (résumé, traduction, re-chunking, embedding) ne
  l'appelle. Il n'y a pas encore de transformation en V1, donc rien n'est
  actuellement mal classé ; le jour où une arrive, elle doit passer par là.
- ~~**§6 audit `egress.decision`**~~ — **CLOS le 2026-08-30.**
  `policy/audit.ts` construit l'entrée (hash, destination qualifiée
  local/remote, décision, raison, version du guard, horodatage) et
  `InMemoryEgressAudit` l'émet sur le `DomainBus`. Le routeur et la façade
  l'appellent pour **chaque** décision, allow comme deny — une trace qui ne
  garderait que les refus ne dirait pas ce qui est réellement sorti.
  `decideEgress` reste pure : une fonction de décision qui journalise ne peut
  pas être testée sans sink. Le sink est câblé au point de composition et non
  laissé optionnel, faute de quoi il serait « déclaré et jamais présent »,
  exactement ce qui a produit ce défaut.
  **Reste** : la trace vit le temps de la composition ; la persister dans le
  control log Class C est la seconde moitié du §6.
- **Guard côté Rust** — ADR-KNOW-0006 annonce
  `crates/unifia-knowledge-core/src/port/transport.rs`. Ce module n'existe
  pas ; le crate n'a pas de répertoire `port/`.

**Pourquoi ce n'est pas une fuite aujourd'hui** : le sous-système ne contient
aucun code réseau. Le risque se matérialise au premier appel provider ajouté.

**Levée** : implémenter §3 et §6, ou amender à nouveau l'ADR pour les retirer
explicitement de V1.

## R-0013 — Aucun chemin d'écriture, aucun daemon MCP

**Sévérité** : moyenne (fonctionnelle, pas sécuritaire)
**Statut** : **CLOS** le 2026-08-30 (cartes C25 et C26)
**Ouvert le** : 2026-08-30, après la contre-revue production-readiness

Deux surfaces sont durcies mais non déployées :

- **Écriture Class A** — aucune implémentation de `MutationWriter` n'existe.
  `knowledge_propose` refuse par construction, honnêtement, mais V1 ne peut
  rien mémoriser. Une couche mémoire en lecture seule est utile ; elle n'est
  pas complète.
- **Transport MCP** — `composeMcpServer()` produit un serveur authentifié,
  scopé et borné, et `mcp-token session` le démontre de bout en bout. Rien ne
  l'expose cependant sur un transport, et le registre de tokens vit dans la
  mémoire du serveur : sans daemon, un token ne survit pas à son processus.

Les deux vont ensemble pour un usage réel : un serveur MCP sans écriture ne
peut pas servir `knowledge_propose`, et un writer sans daemon n'est
atteignable que depuis le processus qui le compose.

**Clôture** :

- **Écriture** — `VaultMutationWriter` écrit Class A pour de vrai : intent
  validé, confinement par chemins réels partagé avec le lecteur, refus des
  credentials, CAS sur le hash observé, WAL persistant avant que le fichier
  ne devienne visible, écriture atomique. `delete` reste refusé
  (ADR-KNOW-0009). Les écritures sont désactivées par défaut :
  `composeKnowledgeService({ writable: true })`.
- **Transport MCP** — `serveMcp()` sert les six capacités en JSON-RPC 2.0 sur
  un transport injecté, en réutilisant `@unifia/mcp-transport` plutôt qu'une
  seconde implémentation. `unifia knowledge mcp serve <workspace>` tient le
  registre pour la durée du processus : un token émis au démarrage reste
  valide, et une révocation prend effet immédiatement.

Vérifié de bout en bout : `propose` → fichier sur disque → entrée WAL →
retrouvé par `search` ; et une requête JSON-RPC sur stdin retourne les 11
notes du vault réel.

**Reste hors périmètre V1** : aucune persistance du registre de tokens entre
deux daemons (un redémarrage invalide les tokens en cours), et `knowledge_propose`
n'est pas accordé au token de session — l'écriture passe par la façade, pas
par MCP.

## R-0014 — Durabilité du chemin d'écriture

**Sévérité** : haute (intégrité des données)
**Statut** : **CLOS** le 2026-08-30 (carte C31)

Le writer écrivait un temporaire, appendait une ligne WAL et renommait —
aucun des trois n'était flushé, rien ne sérialisait deux writers, et rien ne
réconciliait un crash. Une coupure pouvait laisser une entrée WAL sans
fichier, un fichier sans entrée, ou deux processus réutilisant un même numéro
de séquence.

**Invariant de commit implémenté** (`mutation/durability.ts`) :

1. le temporaire est écrit **et fsyncé** ;
2. la ligne WAL est appendée **et fsyncée** — c'est le point de commit ;
3. le rename rend visible (atomique NTFS et POSIX) ;
4. le répertoire est fsyncé là où la plateforme le permet.

L'asymétrie est délibérée : avant l'étape 2, rien ne s'est produit et le
temporaire est jeté ; après, la recovery termine le rename. Il est toujours
sûr de rejouer un rename, jamais d'inventer une entrée WAL.

Un `WriteLock` en `O_EXCL` sérialise le commit entre processus, avec
récupération d'un verrou abandonné par un processus mort (seuil 30 s). La
séquence est dérivée de la dernière entrée durable, pas d'un comptage de
lignes — sinon une ligne tronquée décalerait tous les numéros suivants.

**Bug trouvé par la crash-matrix elle-même** : après une ligne tronquée sans
`
` final, l'append suivant se concaténait à elle et corrompait aussi la
nouvelle entrée. `appendLineDurable` insère désormais un séparateur.

**Couverture** : 15 tests, dont crash avant temporaire, après temporaire avant
WAL, après WAL avant rename, après rename (idempotence), ligne WAL tronquée,
temporaire orphelin, recovery à l'ouverture, verrou tenu, verrou périmé
récupéré, et deux writers concurrents sans collision de séquence.

**Reste hors périmètre V1** : la persistance du control log Class C
(ADR-KNOW-0006 §6, seconde moitié) — la trace d'egress vit le temps de la
composition.

## R-0015 — Quatre non-implémentés sortis du périmètre sans clôture

**Sévérité** : haute (traçabilité) — les items eux-mêmes sont moyens à hauts
**Statut** : OUVERT
**Ouvert le** : 2026-08-30, après les six revues du FINAL-REPORT

L'addendum 1 nommait cinq éléments non implémentés. L'addendum 2 les
reconduisait explicitement. Les addenda 3 et 4 les ont abandonnés sans les
fermer ni les lister hors périmètre. Seul `egress.decision` a été clos
(R-0012 §6). Les quatre autres ont disparu du rapport tout en restant vrais
dans le code.

C'est un défaut de traçabilité avant d'être un défaut technique : **un
finding ne doit jamais disparaître parce qu'un addendum ne le mentionne
plus.** L'affirmation « toutes les cartes connues sont fermées » de
l'addendum 4 était fausse au sens strict.

Vérifié au 2026-08-30 :

| Item | État mesuré | Conséquence |
|---|---|---|
| `DeclassificationGrant` (ADR-KNOW-0006 §3) | absent | rien ne peut élargir un `deny` — fail-closed, mais le partage consenti documenté par l'ADR est impossible |
| Guard d'egress côté Rust | `crates/.../port/` n'existe pas | la parité TS/Rust annoncée par l'ADR n'existe pas |
| Héritage des restrictions | `mostRestrictive()` a **0 consommateur** | aucune transformation n'hérite encore ; le jour où une arrive, elle doit passer par là |
| Persistance Class B / ControlStore | in-memory côté Rust | rien ne survit au processus |

**Aveu de méthode** : `decideEgressBatch` a été supprimé dans la même session
au motif qu'il n'avait aucun consommateur, tandis que `mostRestrictive` était
conservé pour la même raison. Deux poids, deux mesures. `mostRestrictive` est
gardé délibérément — il implémente la règle §3 et sera l'unique point
d'héritage — mais ce choix devait être écrit, pas tacite.

**Levée** : implémenter chacun, ou l'amender explicitement hors de V1 dans
son ADR. Pas de troisième voie.

## R-0016 — Statut des probes Android non ré-arbitré après C24

**Sévérité** : moyenne (intégrité de preuve)
**Statut** : OUVERT

Le run device `3b58248c0f` a enregistré `PASS_WITH_SAFE_FALLBACK` sur Xiaomi
Mi 10 Pro. La carte C24 a ensuite établi que `runProbes` transformait une
`ProbeEvidence` vide en `PASS`. **Ce run n'a jamais été rejoué depuis.**

Le rapport dit tour à tour : device run non exécuté, artefacts présents,
`PASS_WITH_SAFE_FALLBACK`, puis « pas de device Android », puis Android hors
champ. Ces cinq états ne peuvent pas être vrais ensemble.

**Position retenue** : le run antérieur à C24 est considéré **invalidé**, car
il a été produit par le harness qui fabriquait des `PASS`. Le statut Android
est `NOT_EXECUTED_EXTERNAL_BOUNDARY` jusqu'à un run rejoué fournissant une
`ProbeEvidence` complète (commande, device id, horodatage valide, sortie).

**Levée** : rebrancher le device et rejouer
`bun test test/knowledge/mobile` avec evidence du harness.

## R-0017 — Périmètre V1 : pas d'effacement, pas d'export, pas de rétention

**Sévérité** : haute (promesse produit)
**Statut** : **CLOS** le 2026-08-30 — décision propriétaire prise et implémentée

**Décision** : « on doit pouvoir tout éditer et supprimer comme dans
Obsidian ». L'édition existait déjà (`update`). La **suppression est
implémentée** (carte C33) avec la sémantique par défaut d'Obsidian : la note
quitte son locator, part en `.unifia/trash/`, l'opération est écrite au WAL
et reste **restaurable** par son `auditId`. ADR-KNOW-0009 amendé en
conséquence — ce que P10 interdit est une opération destructive *silencieuse*,
pas le droit de l'utilisateur à retirer une note.

Vérifié de bout en bout : créer → éditer → supprimer (absente du disque et
des listings) → restaurer, avec un WAL portant `create, update, delete,
restore`.

**Complété le même jour** :

- **Vidage de la corbeille** (C33b) — `emptyTrash({ confirm: true })`. La
  confirmation est un paramètre *requis* : personne ne vide la corbeille en
  passant un objet d'options auquel il n'a pas réfléchi. Le purge est écrit
  au WAL avant de détruire — une effacement sans trace serait l'opération
  destructive silencieuse que P10 interdit, un cran plus bas. Purge sélective
  par `auditId` ou par âge.
- **Export utilisateur** (C34) — `exportVault()` copie le vault hors de
  lui-même et écrit un manifeste avec un hash par note, vérifiable ensuite
  sans le vault d'origine. **L'audience est explicite** : `owner` exporte
  tout, `third-party` respecte `exportable` et déclare ce qu'il a retenu.
  `exportable` gouverne un tiers qui reçoit le contenu, pas le propriétaire
  qui prend une copie de ses propres données ; conditionner son export à ce
  drapeau transformerait une garantie de souveraineté en verrou sur ses
  données.
- **TTL et rétention** (C35) — `retentionReport()` signale les `candidate`
  au-delà des 30 jours annoncés par ADR-KNOW-0009 §1 et les entrées de
  corbeille purgeables. **Le module rapporte, il n'agit pas** : l'ADR rejette
  un « lifecycle implicite basé sur timestamp » comme trop magique et sans
  traçabilité. Le système remarque ; l'opérateur décide.

L'utilisateur peut désormais voir, éditer, supprimer et exporter ses données.

Le périmètre initial du Sovereign Knowledge Core mentionnait notamment le
droit de voir, éditer, **supprimer** et **exporter** ses données, un `forget`,
un TTL et une politique de rétention. Aucun n'est implémenté :

- `delete` est **refusé par construction** (ADR-KNOW-0009 rejette la
  suppression physique) ; `archive`, `move` et `supersede` ne constituent pas
  un droit effectif à l'effacement ;
- aucun export utilisateur ;
- aucun TTL ni rétention — y compris le TTL de 30 jours des `candidate` que
  l'ADR-KNOW-0009 §1 annonce.

Pour un produit dont la promesse est la souveraineté, l'absence de droit à
l'effacement n'est pas un détail de périmètre.

**Décision requise** : soit ces éléments entrent en V1, soit V1 est
explicitement requalifiée « fondation lexicale en lecture seule » et la
promesse produit est réécrite en conséquence. Le rapport ne peut pas parler
de « Sovereign Knowledge Core V1 » sans que ce choix soit tranché et écrit.
