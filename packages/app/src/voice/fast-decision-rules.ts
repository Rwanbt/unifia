/* SPDX-License-Identifier: MIT */
import type {
  FastDecisionProvider,
  FastDecisionInput,
  DecisionProposal,
  FastDecisionCapabilities,
  FastDecisionKind,
} from "@unifia/contracts/fast-decision"
import type { SpeechLanguage } from "@unifia/contracts/speech"

/**
 * `rules` FastDecision provider — the production default.
 *
 * §28: "Implement hot load/unload. Implement safe provider
 * switching." Rules has no model, no worker, no download. It is a
 * small, deterministic keyword + regex classifier that maps a
 * transcript (partial or final) to one of the eight
 * FastDecisionKinds.
 *
 * Hard rule: Rules MUST NOT be the authority over LLM, tools, or
 * permissions. Its output is a *proposal*; VoiceCore decides what
 * to do (mute TTS, drop the partial, forward to Unifia). In
 * particular, `cancel-task` is only forwarded if the user is
 * allowed to cancel the active task per the Unifia authority layer.
 *
 * Calibration: every match returns confidence 1.0. The default
 * fallback (`continue`) returns confidence 0.0. Consumers may
 * threshold; Rules does not produce intermediate confidences
 * because keyword matches are deterministic. A future "soft"
 * Rules provider may emit probabilistic confidences for partial
 * transcripts.
 *
 * Localisation: patterns are tagged with their target language and
 * only fire when the input language matches. This prevents
 * cross-language false positives (e.g. the German "ok" pattern
 * catching English "ok" because the regex was case-insensitive).
 * Adding a new language is a single rule-list addition — no
 * model, no download.
 */

export const RULES_FAST_DECISION_PROVIDER_ID = "rules" as const

const RULES_CAPABILITIES: FastDecisionCapabilities = {
  providerId: RULES_FAST_DECISION_PROVIDER_ID,
  languages: ["en", "fr", "es", "it", "de"],
  warmLatencyMs: 0,
  peakRssBytes: 0,
  requiresModelDownload: false,
}

interface Rule {
  readonly kind: Exclude<FastDecisionKind, "continue">
  readonly languages: readonly SpeechLanguage[]
  readonly pattern: RegExp
  readonly rationale: string
}

const RULES: readonly Rule[] = [
  // cancel-speech — assistant should stop talking but the task
  // continues. Distinct from cancel-task per §27. Listed first so
  // the more specific phrases ("arrête de parler", "halt die
  // klappe", "stop talking") win against the broader cancel-task
  // keywords ("arrête", "stop", "halt").
  {
    kind: "cancel-speech",
    languages: ["en"],
    rationale: "cancel-speech:en:shh",
    pattern: /\b(shh|shush|hush|be\s+quiet|quiet|stop\s+talking|stop\s+speaking|silence)\b/i,
  },
  {
    kind: "cancel-speech",
    languages: ["fr"],
    rationale: "cancel-speech:fr:chut",
    pattern: /\b(chut|silence|tais[-\s]*toi|arrête\s+de\s+parler|arrête\s+de\s+parle|taisez[-\s]*vous)\b/i,
  },
  {
    kind: "cancel-speech",
    languages: ["es"],
    rationale: "cancel-speech:es:silencio",
    pattern: /\b(silencio|cállate|callate|ssh|chitón|chiton)\b/i,
  },
  {
    kind: "cancel-speech",
    languages: ["it"],
    rationale: "cancel-speech:it:zitto",
    pattern: /\b(zitto|silenzio|taci|smettila)\b/i,
  },
  {
    kind: "cancel-speech",
    languages: ["de"],
    rationale: "cancel-speech:de:ruhe",
    pattern: /\b(ruhe|psst|sst|sei\s+still|schweig|halt\s+die\s+klappe)\b/i,
  },

  // cancel-task — explicit "stop everything" / "never mind". The
  // user is asking to abort the active task; VoiceCore forwards
  // to Unifia, which decides whether the request is allowed.
  // Listed AFTER cancel-speech so that "stop talking" / "arrête
  // de parler" / "halt die klappe" match the more specific rule
  // first.
  {
    kind: "cancel-task",
    languages: ["en"],
    rationale: "cancel-task:en:stop-everything",
    pattern: /\b(stop|cancel|abort|never\s*mind|forget\s*it|forget\s*about\s*it)\b/i,
  },
  {
    kind: "cancel-task",
    languages: ["fr"],
    rationale: "cancel-task:fr:annuler",
    pattern: /\b(annule|annuler|arrête|arrete|oublie|laisse\s+tomber)\b/i,
  },
  {
    kind: "cancel-task",
    languages: ["es"],
    rationale: "cancel-task:es:cancelar",
    pattern: /\b(cancela|cancelar|para|olvídalo|olvidalo)\b/i,
  },
  {
    kind: "cancel-task",
    languages: ["it"],
    rationale: "cancel-task:it:annulla",
    pattern: /\b(annulla|cancella|fermati|lascia\s+perdere|lascia\s+sta)\b/i,
  },
  {
    kind: "cancel-task",
    languages: ["de"],
    rationale: "cancel-task:de:abbrechen",
    pattern: /\b(abbrechen|stopp|vergiss\s*es|lass\s*es)\b/i,
  },

  // correction — "I meant X, not Y". Only matches when the user
  // is clearly amending what was just said. Punctuation after
  // "actually" / "en realidad" is optional because STT often drops
  // commas.
  {
    kind: "correction",
    languages: ["en"],
    rationale: "correction:en:actually",
    pattern: /\b(no\s+wait|actually[,.]?\s+i\s+meant|i\s+meant\s+to\s+say|sorry,?\s*i\s+meant|correction|let\s+me\s+rephrase)\b/i,
  },
  {
    kind: "correction",
    languages: ["fr"],
    rationale: "correction:fr:rectification",
    pattern: /\b(non[,]?\s+attends|en\s+fait\s+je\s+voulais\s+dire|je\s+voulais\s+dire|pardon[,]?\s+je\s+voulais|rectif(?:ie|ions)|autrement\s+dit)\b/i,
  },
  {
    kind: "correction",
    languages: ["es"],
    rationale: "correction:es:rectificación",
    pattern: /\b(no[,]?\s+espera|en\s+realidad[,.]?\s+quise\s+decir|en\s+realidad[,.]?\s+quería\s+decir|perdón[,]?\s+quise\s+decir|mejor\s+dicho)\b/i,
  },
  {
    kind: "correction",
    languages: ["it"],
    rationale: "correction:it:correzione",
    pattern: /\b(no[,]?\s+aspetta|in\s+realtà[,.]?\s+intendevo|scusa[,]?\s+intendevo|intendevo\s+dire)\b/i,
  },
  {
    kind: "correction",
    languages: ["de"],
    rationale: "correction:de:korrektur",
    pattern: /\b(nee[,]?\s+warte|ich\s+wollte\s+eigentlich\s+sagen|korrektur|ich\s+meinte)\b/i,
  },

  // new-request — only explicit topic/request transitions classify
  // here. Generic content remains `continue`; the rule must not
  // infer a new task merely because a sentence contains an imperative.
  {
    kind: "new-request",
    languages: ["en"],
    rationale: "new-request:en:topic-transition",
    pattern: /\b(new\s+request|different\s+question|another\s+thing|on\s+another\s+topic|switch\s+topics?)\b/i,
  },
  {
    kind: "new-request",
    languages: ["fr"],
    rationale: "new-request:fr:topic-transition",
    pattern: /\b(autre\s+question|autre\s+sujet|nouvelle\s+demande|changeons\s+de\s+sujet|passons\s+à\s+autre\s+chose)\b/i,
  },
  {
    kind: "new-request",
    languages: ["es"],
    rationale: "new-request:es:topic-transition",
    pattern: /\b(otra\s+pregunta|otro\s+tema|nueva\s+petición|nueva\s+peticion|cambiemos\s+de\s+tema|cambiando\s+de\s+tema)\b/i,
  },
  {
    kind: "new-request",
    languages: ["it"],
    rationale: "new-request:it:topic-transition",
    pattern: /\b(un'altra\s+domanda|altra\s+domanda|nuova\s+richiesta|altro\s+argomento|cambiamo\s+argomento)\b/i,
  },
  {
    kind: "new-request",
    languages: ["de"],
    rationale: "new-request:de:topic-transition",
    pattern: /\b(andere\s+frage|neue\s+frage|neues\s+thema|anderes\s+thema|themenwechsel)\b/i,
  },

  // permission-answer — short yes/no to a pending permission. The
  // exact id match happens in `lastAssistantText`; the bare yes/no
  // is a strong hint but not a guarantee.
  {
    kind: "permission-answer",
    languages: ["en"],
    rationale: "permission-answer:en:yes",
    pattern: /^\s*(yes|yeah|yep|sure|go\s+ahead|do\s+it|approve|ok[,]?\s+go)\s*[.!]?\s*$/i,
  },
  {
    kind: "permission-answer",
    languages: ["en"],
    rationale: "permission-answer:en:no",
    pattern: /^\s*(no|nope|nah|don't|do\s+not|deny|reject|refuse)\s*[.!]?\s*$/i,
  },
  {
    kind: "permission-answer",
    languages: ["fr"],
    rationale: "permission-answer:fr:oui",
    pattern: /^\s*(oui|ouais|vas[-\s]*y|approuve)\s*[.!]?\s*$/i,
  },
  {
    kind: "permission-answer",
    languages: ["fr"],
    rationale: "permission-answer:fr:non",
    pattern: /^\s*(non|pas\s+d'accord|refuse|rejette)\s*[.!]?\s*$/i,
  },
  {
    kind: "permission-answer",
    languages: ["es"],
    rationale: "permission-answer:es:si",
    pattern: /^\s*(sí|si|claro|adelante|apruebo)\s*[.!]?\s*$/i,
  },
  {
    kind: "permission-answer",
    languages: ["es"],
    rationale: "permission-answer:es:no",
    pattern: /^\s*(no|rechazo|deniego|rechaza)\s*[.!]?\s*$/i,
  },
  {
    kind: "permission-answer",
    languages: ["it"],
    rationale: "permission-answer:it:si",
    pattern: /^\s*(sì|si|certo|va\s+bene|avanti|approvo)\s*[.!]?\s*$/i,
  },
  {
    kind: "permission-answer",
    languages: ["it"],
    rationale: "permission-answer:it:no",
    pattern: /^\s*(no|rifiuto|neanche|negare)\s*[.!]?\s*$/i,
  },
  {
    kind: "permission-answer",
    languages: ["de"],
    rationale: "permission-answer:de:ja",
    pattern: /^\s*(ja|okay|los|genehmige|bestätige)\s*[.!]?\s*$/i,
  },
  {
    kind: "permission-answer",
    languages: ["de"],
    rationale: "permission-answer:de:nein",
    pattern: /^\s*(nein|nö|nope|lehne\s+ab|verweigere)\s*[.!]?\s*$/i,
  },

  // acknowledgement — short filler that is not noise and not a
  // permission answer. Distinct from permission-answer because
  // there is no pending question to answer.
  {
    kind: "acknowledgement",
    languages: ["en"],
    rationale: "acknowledgement:en",
    pattern: /^\s*(okay|sure|right|got\s+it|makes\s+sense|sounds\s+good|fine)\s*[.!]?\s*$/i,
  },
  {
    kind: "acknowledgement",
    languages: ["fr"],
    rationale: "acknowledgement:fr",
    pattern: /^\s*(d'accord|compris|ça\s+marche|entendu|bien\s+sûr)\s*[.!]?\s*$/i,
  },
  {
    kind: "acknowledgement",
    languages: ["es"],
    rationale: "acknowledgement:es",
    pattern: /^\s*(vale|de\s+acuerdo|entendido|claro|perfecto)\s*[.!]?\s*$/i,
  },
  {
    kind: "acknowledgement",
    languages: ["it"],
    rationale: "acknowledgement:it",
    pattern: /^\s*(va\s+bene|ho\s+capito|capito|perfetto|giusto)\s*[.!]?\s*$/i,
  },
  {
    kind: "acknowledgement",
    languages: ["de"],
    rationale: "acknowledgement:de",
    pattern: /^\s*(verstanden|alles\s+klar|gut|gemacht|klar)\s*[.!]?\s*$/i,
  },

  // noise — short non-content audio. The classifier intentionally
  // keeps this conservative: false-positive noise classification
  // suppresses real user turns, which is worse than the cost of
  // passing filler through to the LLM. We only classify as noise
  // when the partial is empty or contains only punctuation.
  // Noise is language-agnostic (it only matches empty / punctuation),
  // but we still tag all five languages for symmetry and to allow
  // future language-specific noise patterns to slot in.
  {
    kind: "noise",
    languages: ["en", "fr", "es", "it", "de"],
    rationale: "noise:empty-or-punctuation",
    pattern: /^\s*[.…,;:\-—_]*\s*$/,
  },
]

/**
 * Classify a transcript using the Rules provider.
 *
 * Behaviour:
 *  - Each rule is tagged with its target language(s). Only rules
 *    whose language list includes the input language are tested.
 *    This prevents cross-language false positives (e.g. the German
 *    `okay` pattern matching English "ok").
 *  - Within the language-scoped subset, the first matching rule
 *    (by source-order priority) wins. Source order encodes
 *    priority: cancel-speech > cancel-task > correction >
 *    permission-answer > acknowledgement > noise.
 *  - If no rule matches, returns `continue` with confidence 0.
 *  - The provider never mutates the input and never throws on
 *    invalid input (e.g., unknown language code).
 */
export const rulesFastDecisionProvider: FastDecisionProvider = {
  providerId: RULES_FAST_DECISION_PROVIDER_ID,
  capabilities: RULES_CAPABILITIES,
  decide(input: FastDecisionInput): DecisionProposal {
    const text = input.text.trim()
    for (const rule of RULES) {
      if (!rule.languages.includes(input.language)) continue
      if (rule.pattern.test(text)) {
        return {
          kind: rule.kind,
          confidence: 1,
          language: input.language,
          sourceText: input.text,
          emittedAt: input.capturedAt,
          rationale: rule.rationale,
        }
      }
    }
    return {
      kind: "continue",
      confidence: 0,
      language: input.language,
      sourceText: input.text,
      emittedAt: input.capturedAt,
      rationale: "rules-default-continue",
    }
  },
  dispose(): void {
    // Rules holds no resources — nothing to release.
  },
}
