<!-- SPDX-License-Identifier: MIT -->
# UNIFIA VOICE — dossier autonome de revue technique

**Snapshot :** 25 septembre 2026, branche Git `voice`, commit
`535d49f5779b0f67674cb25406a89600d01c61ff`.

**Usage de ce document :** il est destiné à être transmis tel quel à une autre
IA ou à un ingénieur sans accès à notre conversation. Il décrit les exigences,
le code observé, les tests déjà effectués, les limites des preuves et les
questions à résoudre. Il ne contient aucun secret ni identifiant fournisseur.
Les chemins de code sont relatifs à la racine du dépôt Unifia. Certaines
preuves historiques citées sont antérieures au commit du snapshot.

## 1. Question à résoudre

L'utilisateur veut que la conversation vocale Live ait **la même implémentation
fonctionnelle sur PC et Android**, avec Parakeet pour la transcription, le LLM
et les outils de la session Unifia existante pour la réponse, puis Pocket TTS
pour la parole et Piper en repli. Le téléphone doit pouvoir faire fonctionner
toute la chaîne **seul, sans PC, sans serveur vocal distant et sans réseau**
lorsqu'un LLM local et les modèles vocaux locaux sont sélectionnés. Un LLM
distant explicitement choisi peut suivre son chemin réseau habituel. La dictée,
la lecture vocale manuelle et Live doivent être cohérents entre les plateformes.

L'utilisateur demande pourquoi Android n'utilise pas le même détecteur de fin
de tour que le PC, s'il est possible de forker `sherpa-onnx` pour les modèles
Pocket récents et français, et quel chemin permet la vraie parité sans sacrifier
le fonctionnement autonome du téléphone.

**Critère de parité proposé :** mêmes contrats de session, modèles de parole
versionnés, langues et voix sélectionnées, règles de fin de tour, rendu du texte
parlé, interruption, routage Pocket/Piper et codes d'erreur. La capture et la
lecture audio ont nécessairement des adaptateurs OS distincts. Une identité
bit à bit des échantillons audio x86/ARM n'est pas exigée ; la qualité, les
transcriptions, les tours et les voix doivent être comparés sur un corpus fixe.

## 2. État du dépôt et du téléphone au snapshot

- Checkout : `D:/App/unifia/voice-runtime`, branche `voice`, suivie par
  `origin/voice`, HEAD ci-dessus. Les fichiers de code suivis étaient propres.
  Deux documents d'analyse non commités existent dans le checkout :
  `docs/voice-current-state-2026-09-25.md` et
  `docs/rfcs/RFC-VOICE-PARITY-PC-ANDROID-2026-09-25.md`. Des artefacts de build
  et caches Python non suivis existaient déjà ; ils n'ont pas été effacés.
- Derniers commits pertinents : `2e6f199` direction Android autonome (16:09),
  `36e9a7a` orchestration de session locale (16:26), `63944fe` transport Live
  Android (16:26), `89feaf7` lecture locale (16:32), `ba27b53` interruption
  locale (16:35), `535d49f` initialisation audio avant capture (17:02).
- Téléphone observé par ADB : Xiaomi Mi 10 Pro ARM64, application
  `ai.unifia.mobile` version 0.1.0 installée le 25 septembre à **16:54:04**.
  Le processus de l'application tournait lors de la lecture d'état. Le dernier
  commit `535d49f` est postérieur à l'installation : **l'APK installé ne
  qualifie pas ce commit**. Son hash exact n'a pas été établi.
- Lecture mémoire ponctuelle au repos : environ 1,10 Go `MemAvailable` et
  0,61 Go `SwapFree`. Ce n'est ni une mesure sous Live ni une preuve que
  Pocket + Parakeet + LLM coexistent en mémoire.
- L'interrogation des runs GitHub a échoué car le proxy local configuré
  `127.0.0.1:9` refusait la connexion. Aucun statut CI actuel n'est revendiqué.
- Aucun nouveau test, build ou parcours physique n'a été exécuté pour rédiger
  ce dossier. Les 3 500 dernières lignes de logcat lues ne contenaient pas de
  trace Voice/exception correspondante ; cela ne prouve pas l'absence d'erreur
  lors d'une nouvelle tentative.

## 3. Pourquoi les deux chemins ont divergé

Le **premier parcours mobile** était un client WebRTC d'une salle LiveKit
hébergée par le PC. Le PC exécutait le Voice Host Python, Silero VAD et le
modèle de fin de tour LiveKit `turn-detector-v1-mini`. Le téléphone bénéficiait
donc du traitement du PC **en envoyant son audio au PC**. Ce parcours échouait
au besoin « téléphone seul ».

Les commits du 25 septembre ont créé un chemin Android local. Pour livrer
rapidement une tranche fonctionnelle, ce chemin a utilisé le micro WebView,
un seuil de volume RMS et une voix système Android/WebView. Le plan de dépôt
`docs/PLAN-ANDROID-STANDALONE-VOICE.md` indique que Silero natif, Pocket
Android et Piper Android restent ouverts. Le seuil RMS est donc un **substitut
transitoire explicite**, pas le détecteur PC porté sur téléphone.

Le contrôleur d'interface Live est partiellement commun, mais le traitement
vocal, le flux de l'agent et la synthèse sont actuellement différents.
Présenter les deux implémentations comme identiques serait incorrect.

## 4. Architecture réellement implémentée

### 4.1 PC

```text
Micro PC → salle LiveKit locale → Silero VAD
         → LiveKit turn-detector-v1-mini → Parakeet TDT v3 INT8
         → Unifia VoiceAgentBridge
         → POST /session/:id/prompt_async + flux /event
         → découpage/rendu incrémental de la réponse
         → Pocket TTS Python en premier, Piper subprocess en repli
         → PCM/LiveKit → haut-parleur PC
```

Le Voice Host n'est **pas** un second agent avec ses propres outils : il
transmet le tour à la session Unifia, qui conserve le fournisseur, le modèle,
l'agent, les outils, permissions et données de projet. La réponse est reçue
en flux, segmentée et synthétisée par morceaux. L'implémentation relève de
`packages/voice-host/voice_host/live/agent.py`, `bridge.py`, `stt.py`,
`segmenter.py`, `renderer.py`, `tts.py`, `language.py` et `__main__.py`.

Le PC utilise `inference.TurnDetector(version="v1-mini")` à l'intérieur de
LiveKit Agents. Silero et le détecteur de fin de tour sont deux étapes
distinctes : Silero détecte les périodes de parole ; le détecteur LiveKit
estime si l'utilisateur a terminé son tour.

### 4.2 Android autonome actuel

```text
Micro téléphone → WebView getUserMedia / ScriptProcessorNode
                → seuil RMS et TurnEndpointing TypeScript
                → WAV base64 → commande native stt_transcribe
                → Parakeet TDT v3 INT8 via Rust/ONNX Runtime
                → session.prompt (attend la réponse complète)
                → speechSynthesis WebView / voix système locale
                → haut-parleur téléphone
```

`packages/app/src/components/prompt-input/live-binding.ts` choisit
`transport: "local"` pour la plateforme mobile. Le chemin ne crée ni salle
LiveKit ni Voice Host PC. `packages/app/src/voice/android-local-voice.ts`
calcule une énergie RMS, puis transmet `0.9` ou `0.1` à
`TurnEndpointing` selon le seuil. Aucune inférence Silero n'a lieu dans ce
chemin. `packages/mobile/src-tauri/src/speech.rs` héberge Parakeet natif.

`packages/app/src/voice/android-offline-tts.ts` cherche dans WebView une voix
`speechSynthesis` avec `localService=true` et une langue compatible. Cela
n'utilise **ni Pocket ni Piper** et ne respecte pas la sélection Pocket/Piper
affichée dans les paramètres Audio. `tts.prepare()` s'exécute avant le
chargement STT et l'ouverture du micro. Si aucune voix locale n'est annoncée,
Live peut échouer immédiatement, mais ce n'est pas encore prouvé sur l'APK
qui a affiché le message d'échec.

`packages/app/src/voice/local-session.ts` appelle `session.prompt` et attend
les parties texte de la réponse complète. Il vérifie l'erreur de l'enveloppe
SDK mais ne traite pas l'erreur pouvant figurer dans `assistant.info.error`.
`live-controller.ts` convertit la plupart des exceptions non spécialisées en
`unknown`, ce qui produit « la conversation Live a échoué » sans indiquer le
stade fautif. Le chemin mobile ne partage pas encore la segmentation, le
rendu du texte parlé, le routage TTS ni les événements en flux du PC.

### 4.3 Ancien mode distant facultatif

La documentation décrit un mode où le téléphone rejoint le Voice Host PC via
WebRTC. Ce mode expliquerait l'usage du même détecteur LiveKit, puisqu'il
tourne sur le PC. Il n'est pas le chemin que sélectionne aujourd'hui le
compositeur Android local. Il ne peut jamais tenir lieu de preuve pour le
mode autonome demandé.

## 5. Preuves de tests réellement disponibles

| Domaine | Résultat rapporté et source du dépôt | Ce que cela ne démontre pas |
|---|---|---|
| Pocket sur Windows | Gate D du 24 septembre : application NSIS installée, synthèse réelle EN/FR/ES/IT/DE, fichiers WAV validés, annulation du worker et deux redémarrages automatiques après crash. `docs/voice-runtime-baseline.md`, section « Final Gate D certification ». | Pas un appel Live complet avec micro, Parakeet et session LLM réelle. |
| Régressions historiques Windows | Gate D : 47/47 tâches typecheck, 1 643 tests unitaires app, 24 tests Voice Host, `cargo check` desktop rapportés verts. Même source. | Exécutés avant les derniers commits Android du 25 septembre. |
| Transport LiveKit | Quatre essais d'intégration Linux avec vrai serveur LiveKit, WebRTC, Silero et détecteur LiveKit. Connexion 191–217 ms ; arrêt audio après début de parole 512–557 ms ; aucune soumission dupliquée. `docs/voice-live.md`, section « Tests and measurements ». | Parakeet, Pocket/Piper et serveur Unifia étaient simulés. Pas de test physique PC cible de bout en bout. |
| Composants Android | Tests unitaires présents pour `TurnEndpointing`, session locale, voix WebView hors ligne et branche locale du contrôleur. | Micro, TTS système, STT natif, LLM et appareil réel sont remplacés par des doubles. Aucun résultat d'exécution de ces tests au HEAD courant n'a été retrouvé. |
| Dictée Android | L'utilisateur rapporte que le speech-to-text marche bien et réagit vite sur son téléphone. | Observation utilisateur ; pas de corpus chronométré ni mesure de précision archivée. |
| Live Android | L'utilisateur rapporte l'échec générique à l'ouverture. | Aucun tour local complet et aucun stack trace du stade exact. |
| Application mobile adjacente | L'utilisateur a aussi rapporté des superpositions UI, des difficultés de connexion fournisseur et un délai de santé du serveur local. Des commits mobile précèdent la tranche Voice. | Aucun de ces parcours n'a été requalifié durant cette analyse ; leur état actuel reste inconnu. |

**Verdict probatoire :** plusieurs sous-systèmes PC ont des preuves solides
mais limitées ; la conversation Live complète sur le PC cible et sur Android
autonome n'a pas été qualifiée. La production et la parité PC/mobile sont
**NO-GO** à ce snapshot.

## 6. Causes établies et hypothèses à départager

### Établi par lecture du code

1. Android local utilise RMS, pas Silero ni le modèle de tour LiveKit.
2. Android local utilise la voix système WebView, pas Pocket/Piper.
3. Android attend toute la réponse LLM avant de commencer le TTS, contrairement
   au PC qui traite un flux.
4. Les réglages Pocket/Piper et des voix affichés sur mobile ne correspondent
   pas au moteur de synthèse réellement invoqué.
5. Le code de session Android peut ignorer `assistant.info.error` et le
   contrôleur généralise des erreurs en `unknown`.
6. L'APK installé à 16:54 est antérieur au dernier commit à 17:02.

### Hypothèses pour l'échec actuellement rapporté

1. **Voix hors ligne introuvable dans WebView** lors de `tts.prepare()` :
   plausible pour un échec immédiat, non observé dans une trace d'APK.
2. **Modèle Parakeet absent, téléchargement/chargement échoué ou micro refusé** :
   également possibles avant le premier tour. La dictée réussie rend une
   panne totale de Parakeet moins probable sur l'APK testé, sans exclure le
   chemin Live ou une différence de build.
3. **Serveur local/LLM/fournisseur non prêt ou modèle refusé** : possible après
   transcription. L'erreur pourrait être masquée par `info.error` ignoré.

Aucune de ces hypothèses ne doit être annoncée comme **la** cause avant une
reproduction sur APK identifié avec journalisation par étape. Le retour
`tts_default_synth = null` des paramètres Android n'identifie pas la voix
effectivement visible depuis WebView et ne suffit pas comme preuve.

## 7. Veille technique et juridique

- [Kyutai Pocket TTS](https://github.com/kyutai-labs/pocket-tts) annonce
  actuellement anglais, français, allemand, portugais, italien et espagnol.
  Le contrat Unifia actuel dans `packages/contracts/src/speech.ts` limite le
  produit à **EN/FR/ES/IT/DE** ; ajouter le portugais serait une décision
  fonctionnelle distincte. Les poids, voix, configurations, versions et
  licences doivent être épinglés individuellement.
- [sherpa-onnx pour Android](https://k2-fsa.github.io/sherpa/onnx/android/build-sherpa-onnx.html)
  offre des API et binaires ARM64. Son
  [paquet Pocket documenté](https://k2-fsa.github.io/sherpa/onnx/tts/pocket.html)
  est l'export INT8 anglais de janvier 2026. Une
  [demande amont encore ouverte](https://github.com/k2-fsa/sherpa-onnx/issues/3755)
  rapporte que les exports Pocket récents/français ont des états KV en FP16,
  une étape `bos_before_voice` et des comportements EOS différents. Ces
  constats de l'auteur de l'issue sont une **hypothèse technique à reproduire**,
  pas un correctif déjà prouvé.
- Un fork `sherpa-onnx` **est possible** ; son code est sous
  [Apache 2.0](https://github.com/k2-fsa/sherpa-onnx/blob/master/LICENSE).
  Il faut limiter le fork à l'adaptation du protocole Pocket, conserver un
  commit amont précis, comparer chaque langue à Kyutai Python et proposer
  le patch en amont si la preuve est bonne. Le code Pocket est
  [MIT](https://github.com/kyutai-labs/pocket-tts/blob/main/LICENSE), mais
  cela ne remplace pas la vérification des licences des poids et voix choisis.
- [Silero VAD](https://github.com/snakers4/silero-vad) fournit un modèle ONNX
  utilisable sur ARM. Il faut conserver les états du modèle, les fenêtres,
  le rééchantillonnage et les seuils de manière identique sur PC et Android.
- La [licence des modèles LiveKit](https://github.com/livekit/agents/blob/main/MODEL_LICENSE)
  autorise les modèles LiveKit seulement avec **LiveKit Agents**. Elle
  n'interdit pas Android en tant que tel. On ne peut toutefois pas copier
  `turn-detector-v1-mini` dans un moteur Android autonome qui n'utilise pas
  LiveKit Agents. Silero n'est pas ce modèle LiveKit. Le PC peut continuer
  d'utiliser LiveKit dans un parcours optionnel ; pour une implémentation locale
  réellement commune, il faut le même détecteur et la même politique sur les
  deux plateformes, ou prouver qu'Agents fonctionne localement sur Android.
- Le STT Android lie déjà `ort = 2.0.0-rc.10` dans
  `packages/mobile/src-tauri/Cargo.toml`. Ajouter `sherpa-onnx` exige une
  stratégie pour éviter deux binaires ONNX Runtime incompatibles dans l'APK.

## 8. Options d'architecture à examiner

| Option | Avantages | Coûts et limites | Condition de choix |
|---|---|---|---|
| A — Conserver PC LiveKit, porter seulement Android | Changement PC limité ; Android autonome possible | Deux implémentations et deux détecteurs restent à maintenir ; ne satisfait pas strictement « même implémentation » | Seulement si parité de comportement suffit et est acceptée explicitement |
| B — Unifier le mode local PC/Android | Une logique de tour/session/rendu/TTS et modèles versionnés ; téléphone autonome | Migration du chemin PC mature ; Pocket multilingue natif à prouver | Option recommandée **sous réserve** du prototype Android et des tests de non-régression PC |
| C — Porter LiveKit Agents sur téléphone | Préserve éventuellement le détecteur LiveKit | Faisabilité, packaging, mémoire, licences et autonomie à démontrer ; Voice Host Python difficile à embarquer | Uniquement après prototype mesuré sur le Xiaomi |

Architecture B envisagée : un `VoiceTurnEngine` partagé pour les états,
événements Unifia, segmentation du texte, langues, interruption et erreurs ;
un cœur d'inférence portable et versionné pour Silero, Parakeet et Pocket/Piper ;
des adaptateurs audio Windows/Android minces. La session Unifia reste l'unique
autorité pour LLM, outils, permissions et projet. Le PC conserve son chemin
Python/LiveKit pendant la migration et ne bascule qu'après comparaison.
Cette proposition nécessiterait d'amender ou de remplacer l'ADR-058 une fois
validée ; elle ne doit pas être présentée comme déjà implémentée.

## 9. Séquence de correction recommandée

1. **Identifier la panne réelle.** Construire et installer un APK depuis un SHA
   connu ; enregistrer la chaîne d'étapes `voice.start → tts.prepare →
   stt.available/download/load → microphone → session/provider → synthesis`,
   avec erreur structurée. Rejouer l'action utilisateur et sauvegarder logcat.
2. **Réparer le diagnostic et les prérequis.** Exposer l'erreur exacte, vérifier
   la santé du serveur local, le modèle sélectionné et ses identifiants avant
   l'écoute. Corriger la propagation de `assistant.info.error`. Ne jamais
   afficher « prêt » si le TTS, STT ou LLM choisi n'est pas opérationnel.
3. **Prototype du fork Pocket.** Épingler une révision Kyutai et sherpa-onnx,
   reproduire les échecs français, adapter FP16/conditionnement/EOS, produire
   un PCM valide sur ARM64, comparer EN/FR/ES/IT/DE et les voix autorisées au
   runtime Python. Mesurer latence, RSS, taille APK et charge sous LLM local.
4. **VAD commun.** Épingler le même Silero ONNX et les mêmes règles de fin de
   tour sur PC/Android. Mesurer faux déclenchements, pauses, fin de tour et
   interruption avec bruit et écho réels.
5. **Convergence de session et audio.** Même pont `prompt_async` + événements,
   même texte parlé incrémental, même routage Pocket/Piper et mêmes réglages
   effectifs. Préserver les permissions et outils de la session existante.
6. **Qualification physique.** Sur le Xiaomi sans PC, exécuter Live avec LLM
   local en mode avion, puis avec fournisseur distant explicite. Valider dictée,
   lecture manuelle, cinq langues, interruption, erreur de modèle, repli Piper,
   dix minutes d'usage, RAM/CPU/chaleur et logs. Sur Windows, répéter le Live
   de bout en bout avec vrais Parakeet/Pocket. Associer à chaque PASS le SHA du
   code, de l'APK/installeur et les mesures. Un parcours non exécuté reste
   **non qualifié**.

## 10. Questions précises pour l'autre IA

1. Le fork `sherpa-onnx` est-il le meilleur propriétaire du nouveau protocole
   Pocket, ou un autre runtime ONNX unique compatible avec `ort` Rust offre-t-il
   une meilleure maintenance et empreinte mémoire ? Étayer avec fichiers
   upstream, formats de graphes et ABI, sans supposer le support français.
2. Quels changements exacts des exports Kyutai récents faut-il reproduire
   (`bos_before_voice`, KV FP16, EOS, tokenizer, chunks, voix) ? Proposer un
   protocole de comparaison au modèle Python, pas seulement « le WAV sort ».
3. Comment obtenir le **même** comportement de tour sur PC et Android sans
   réutiliser le modèle LiveKit hors de LiveKit Agents ? Quel compromis entre
   Silero + endpointing partagé et un autre détecteur local permissif ?
4. Quel découpage minimal de `VoiceTurnEngine`, de la frontière audio native et
   de l'API Unifia évite deux moteurs d'agent et une duplication de logique ?
5. Sur ce téléphone, quelle politique de chargement/déchargement et quels
   budgets de mémoire permettent de cohabiter avec Parakeet, Pocket et le LLM ?
6. Quels critères mesurables et quels tests physiques rendent la parité et le
   GO production réellement démontrables ?

## 11. Carte de lecture du dépôt

- Contrats : `packages/contracts/src/speech.ts`.
- UI/routage : `packages/app/src/components/prompt-input/live-binding.ts`,
  `packages/app/src/voice/live-controller.ts`, `live-state.ts`,
  `audio-settings.ts` et `packages/app/src/components/settings-audio.tsx`.
- Android : `packages/app/src/voice/android-local-voice.ts`,
  `android-offline-tts.ts`, `local-session.ts` ;
  `packages/mobile/src-tauri/src/speech.rs` et `parakeet/` ;
  `packages/mobile/src/hooks/use-speech.ts`.
- PC : `packages/voice-host/voice_host/live/agent.py`, `bridge.py`, `stt.py`,
  `tts.py`, `segmenter.py`, `renderer.py`, `language.py` ;
  `packages/desktop/src-tauri/src/voice_live.rs`.
- Décision et preuves historiques : `docs/adr/ADR-058-voice-runtime.md`,
  `docs/voice-live.md`, `docs/voice-runtime-baseline.md`,
  `docs/PLAN-ANDROID-STANDALONE-VOICE.md`.

**Conclusion :** le téléphone ne possède pas encore l'équivalent local du
Voice Host PC. Les écarts RMS/Silero, voix système/Pocket et réponse complète/
réponse en flux sont vérifiables dans le code. L'échec Live Android est réel
selon l'observation utilisateur, mais son stade exact n'est pas connu. Le fork
Pocket français est une piste crédible à prototyper ; il ne remplace ni la
reproduction de la panne immédiate, ni l'unification de la détection et de
l'orchestration, ni la qualification physique sur téléphone seul.
