"""Speech language routing shared by STT results and TTS voice selection.

Mirrors ``resolveSpeechLanguage`` in ``@unifia/contracts/speech``: an explicit
preference wins, then the detected language, then the conversation language,
then the application locale, then English. Short or technical utterances keep
the previous automatic language so "OK", "README" or "npm build" do not flip it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

SPEECH_LANGUAGES: tuple[str, ...] = ("en", "fr", "es", "it", "de")

# Words that are identical across the supported languages in a coding context.
# A detection made only from these tokens carries no language information.
LANGUAGE_NEUTRAL_TOKENS = frozenset(
    {
        "ok", "okay", "github", "gitlab", "readme", "npm", "bun", "build", "test", "tests",
        "api", "json", "yaml", "docker", "git", "commit", "push", "pull", "merge", "rust",
        "python", "typescript", "javascript", "node", "cargo", "linux", "windows", "android",
        "unifia", "livekit", "ci", "pr", "bug", "fix", "log", "logs", "stop", "go", "yes", "no",
    }
)
_WORD = re.compile(r"[\w'’-]+", re.UNICODE)


def normalize_language(value: str | None) -> str | None:
    if not value:
        return None
    primary = re.split(r"[-_]", value.strip().lower(), maxsplit=1)[0]
    aliases = {"english": "en", "french": "fr", "spanish": "es", "italian": "it", "german": "de"}
    primary = aliases.get(primary, primary)
    return primary if primary in SPEECH_LANGUAGES else None


def is_language_neutral(text: str | None) -> bool:
    """True when an utterance is too short or technical to carry a language."""
    words = [w.lower().strip("'’-") for w in _WORD.findall(text or "")]
    words = [w for w in words if w]
    if not words:
        return True
    informative = [w for w in words if w not in LANGUAGE_NEUTRAL_TOKENS and not w.isdigit()]
    return len(informative) == 0 or len(words) <= 2


@dataclass
class LanguageRouter:
    """Stateful per-conversation router; avoids oscillation between turns."""

    preference: str = "auto"
    application_locale: str | None = None
    conversation_language: str | None = None
    _history: list[str] = field(default_factory=list)

    def resolve(self, detected: str | None, text: str | None = None) -> str:
        explicit = normalize_language(self.preference) if self.preference != "auto" else None
        if explicit:
            self.conversation_language = explicit
            return explicit
        detected_language = normalize_language(detected)
        if detected_language and not is_language_neutral(text):
            # Require the new language twice in a row before switching an
            # established conversation, unless nothing is established yet.
            if self.conversation_language and detected_language != self.conversation_language:
                recent = self._history[-1:] if self._history else []
                self._history.append(detected_language)
                del self._history[:-4]
                if recent != [detected_language]:
                    # First sighting of a long utterance in a new language is
                    # still trusted: one full sentence is strong evidence.
                    if len(_WORD.findall(text or "")) < 5:
                        return self.conversation_language
            else:
                self._history.append(detected_language)
                del self._history[:-4]
            self.conversation_language = detected_language
            return detected_language
        return (
            self.conversation_language
            or normalize_language(self.application_locale)
            or "en"
        )


# Parakeet TDT v3 transcribes the five languages but does not report which one
# it heard. A function-word vote is reliable for full sentences and abstains on
# short or technical utterances, which the router then keeps stable.
_FUNCTION_WORDS: dict[str, frozenset[str]] = {
    "en": frozenset("the and is are you it this that to of in for with what how can please i we my your do not be".split()),
    "fr": frozenset("le la les et est sont vous tu il elle ce cette que qui de du des un une pour avec je nous mon ton pas ne peux fais".split()),
    "es": frozenset("el la los las y es son usted tú que qué de del un una para con yo nosotros mi tu no por favor puedes cómo".split()),
    "it": frozenset("il lo la gli le e è sono tu lei che di del un una per con io noi mio tuo non puoi come questo".split()),
    "de": frozenset("der die das und ist sind du sie es ein eine für mit ich wir mein dein nicht bitte kannst wie was".split()),
}


def detect_language(text: str | None) -> str | None:
    """Best-effort language of a transcript, or None when the evidence is weak."""
    words = [w.lower() for w in _WORD.findall(text or "")]
    if len(words) < 3:
        return None
    scores = {language: sum(1 for w in words if w in vocab) for language, vocab in _FUNCTION_WORDS.items()}
    ranked = sorted(scores.items(), key=lambda item: item[1], reverse=True)
    (best, best_score), (_, second_score) = ranked[0], ranked[1]
    if best_score < 2 or best_score <= second_score:
        return None
    return best
