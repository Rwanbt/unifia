"""Turn assistant Markdown into text that is safe and pleasant to speak.

Speech is a disclosure channel: anything spoken can be overheard or recorded.
The renderer therefore removes secrets outright and reduces content that is
unreadable aloud (code, JSON, diffs, stack traces, hashes, long URLs) to a
short spoken reference to the conversation, where the full text remains.
"""

from __future__ import annotations

import re

PHRASES: dict[str, dict[str, str]] = {
    "en": {
        "code": "The code is shown in the conversation.",
        "table": "The table is shown in the conversation.",
        "list_rest": "There are {count} more items in the conversation.",
        "link": "a link",
        "secret": "a hidden value",
        "details": "The details are in the conversation.",
        "working": "Okay, I'm on it.",
        "still_working": "Still working on it.",
        "permission": "I need your permission to continue. Please check the conversation.",
        "question": "I have a question for you in the conversation.",
        "error": "Something went wrong. The details are in the conversation.",
    },
    "fr": {
        "code": "Le code est affiché dans la conversation.",
        "table": "Le tableau est affiché dans la conversation.",
        "list_rest": "Il y a {count} autres éléments dans la conversation.",
        "link": "un lien",
        "secret": "une valeur masquée",
        "details": "Les détails sont dans la conversation.",
        "working": "D'accord, je m'en occupe.",
        "still_working": "Je travaille toujours dessus.",
        "permission": "J'ai besoin de votre autorisation pour continuer. Regardez la conversation.",
        "question": "J'ai une question pour vous dans la conversation.",
        "error": "Un problème est survenu. Les détails sont dans la conversation.",
    },
    "es": {
        "code": "El código se muestra en la conversación.",
        "table": "La tabla se muestra en la conversación.",
        "list_rest": "Hay {count} elementos más en la conversación.",
        "link": "un enlace",
        "secret": "un valor oculto",
        "details": "Los detalles están en la conversación.",
        "working": "De acuerdo, me pongo con ello.",
        "still_working": "Sigo trabajando en ello.",
        "permission": "Necesito tu permiso para continuar. Revisa la conversación.",
        "question": "Tengo una pregunta para ti en la conversación.",
        "error": "Algo salió mal. Los detalles están en la conversación.",
    },
    "it": {
        "code": "Il codice è mostrato nella conversazione.",
        "table": "La tabella è mostrata nella conversazione.",
        "list_rest": "Ci sono altri {count} elementi nella conversazione.",
        "link": "un link",
        "secret": "un valore nascosto",
        "details": "I dettagli sono nella conversazione.",
        "working": "Va bene, me ne occupo.",
        "still_working": "Ci sto ancora lavorando.",
        "permission": "Ho bisogno del tuo permesso per continuare. Controlla la conversazione.",
        "question": "Ho una domanda per te nella conversazione.",
        "error": "Qualcosa è andato storto. I dettagli sono nella conversazione.",
    },
    "de": {
        "code": "Der Code wird im Gespräch angezeigt.",
        "table": "Die Tabelle wird im Gespräch angezeigt.",
        "list_rest": "Es gibt {count} weitere Punkte im Gespräch.",
        "link": "ein Link",
        "secret": "ein verborgener Wert",
        "details": "Die Details stehen im Gespräch.",
        "working": "Okay, ich kümmere mich darum.",
        "still_working": "Ich arbeite noch daran.",
        "permission": "Ich brauche deine Erlaubnis, um fortzufahren. Bitte sieh im Gespräch nach.",
        "question": "Ich habe eine Frage an dich im Gespräch.",
        "error": "Etwas ist schiefgelaufen. Die Details stehen im Gespräch.",
    },
}


def phrase(language: str, key: str, **values: object) -> str:
    table = PHRASES.get(language) or PHRASES["en"]
    return table[key].format(**values)


# Secrets are matched before anything else so no later rule can leak them.
_SECRET_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)"),
    re.compile(r"\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}\b"),
    re.compile(r"\bsk-ant-[A-Za-z0-9_-]{16,}\b"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}\b"),
    re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}\b"),
    re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}\b"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\bAIza[0-9A-Za-z_-]{30,}\b"),
    re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b"),
    re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/-]{12,}=*"),
    re.compile(
        r"(?i)\b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret)"
        r"\s*[:=]\s*[\"']?[^\s\"',;]{4,}"
    ),
    re.compile(r"(?i)\b[a-z][a-z0-9+.-]*://[^\s:/@]+:[^\s@/]+@"),
)
_URL = re.compile(r"\b(?:https?|wss?|ftp)://[^\s)>\]]+|\bwww\.[^\s)>\]]+", re.IGNORECASE)
_HASH = re.compile(r"\b(?=[0-9a-fA-F]*[a-fA-F])(?=[0-9a-fA-F]*\d)[0-9a-fA-F]{12,64}\b")
_UUID = re.compile(r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b")
_PATH = re.compile(r"(?<![\w/])(?:[A-Za-z]:\\|~?/|\.{1,2}/)?(?:[\w.@-]+[/\\]){2,}([\w.@-]+)")
_INLINE_CODE = re.compile(r"`([^`\n]*)`")
_MD_LINK = re.compile(r"!?\[([^\]]*)\]\(([^)]*)\)")
_EMPHASIS = re.compile(r"(\*\*|__|\*|_|~~)(?=\S)(.+?)(?<=\S)\1")
_HEADING = re.compile(r"^\s{0,3}#{1,6}\s+", re.MULTILINE)
_QUOTE = re.compile(r"^\s{0,3}>\s?", re.MULTILINE)
_LIST_MARKER = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s+", re.MULTILINE)
_HTML_TAG = re.compile(r"</?[A-Za-z][^>]*>")
_STACK_LINE = re.compile(
    r"^\s*(at\s+\S+\s*\(|at\s+[\w.$<>]+:\d+|File \"[^\"]+\", line \d+|Traceback \(most recent call last\)|"
    r"\w+(Error|Exception):\s|panicked at|thread '.*' panicked)"
)
_DIFF_LINE = re.compile(r"^(?:@@ .* @@|\+\+\+ |--- |diff --git |index [0-9a-f]+\.\.)")
_JSONISH = re.compile(r"^\s*[\[{].*[\"'][\w-]+[\"']\s*:.*$|^\s*\"[\w-]+\"\s*:\s*")


def redact_secrets(text: str, language: str) -> str:
    replacement = phrase(language, "secret")
    for pattern in _SECRET_PATTERNS:
        text = pattern.sub(replacement, text)
    return text


def _is_unspeakable_line(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return False
    if _STACK_LINE.match(stripped) or _DIFF_LINE.match(stripped) or _JSONISH.match(stripped):
        return True
    # Long tokens without spaces (minified code, base64, logs) are noise aloud.
    longest = max((len(token) for token in stripped.split()), default=0)
    if longest > 60:
        return True
    symbols = sum(1 for c in stripped if c in "{}[]();=<>|&$\\")
    return len(stripped) > 12 and symbols / len(stripped) > 0.18


def render(text: str, language: str) -> str | None:
    """Return speakable text for one prose segment, or None to skip it."""
    text = redact_secrets(text, language)
    kept_lines = [line for line in text.splitlines() if not _is_unspeakable_line(line)]
    if not kept_lines:
        return phrase(language, "details") if text.strip() else None
    text = "\n".join(kept_lines)
    text = _HTML_TAG.sub(" ", text)
    text = _MD_LINK.sub(lambda m: m.group(1) or phrase(language, "link"), text)
    text = _URL.sub(phrase(language, "link"), text)
    text = _UUID.sub("", text)
    text = _INLINE_CODE.sub(lambda m: m.group(1) if len(m.group(1)) <= 32 else "", text)
    text = _PATH.sub(lambda m: m.group(1), text)
    text = _HASH.sub("", text)
    text = _HEADING.sub("", text)
    text = _QUOTE.sub("", text)
    text = _LIST_MARKER.sub("", text)
    for _ in range(2):
        text = _EMPHASIS.sub(lambda m: m.group(2), text)
    text = text.replace("`", "").replace("|", " ")
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"\s+([,.;:!?])", r"\1", text)
    text = re.sub(r"\(\s*\)|\[\s*\]", "", text).strip()
    if not re.search(r"\w", text):
        return None
    return text
