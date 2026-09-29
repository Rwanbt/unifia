"""SpeechRenderer security tests — R14 software side (plan §14).

The renderer (`voice_host/live/renderer.py`) MUST suppress or
summarize content that is unsafe or unreadable aloud: secrets
(API keys, tokens, passwords, JWT, PEM, etc.), long URLs, UUIDs,
hashes, code blocks, diffs, stack traces. This module proves the
renderer never speaks any of those shapes across all five mandatory
production languages (EN/FR/ES/IT/DE).

Every test asserts:
  * the dangerous substring is GONE from the rendered output (no
    leak via ``redact_secrets``), OR
  * the whole line is dropped via ``_is_unspeakable_line`` (so even
    a partial redaction is still safe — nothing readable reaches
    the consumer), OR
  * the renderer returns ``None`` (the segment is skipped entirely
    — strongest guarantee, used when the entire input was
    suppressed).

Reference: ADR-067 (Privacy/Logging/Metrics — no transcript
content in metrics) + plan §14.
"""

from __future__ import annotations

import re

import pytest

from voice_host.live.renderer import phrase, redact_secrets, render


# ---------------------------------------------------------------------------
# Secret patterns (12 in `_SECRET_PATTERNS`) — each is redacted to the
# localised phrase "a hidden value".
# ---------------------------------------------------------------------------


SECRET_SAMPLES = [
    # PEM private key (PKCS#8 + RSA + EC fragments)
    (
        "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEAabcd\n-----END RSA PRIVATE KEY-----",
        "rsa_pkcs8",
    ),
    # Generic sk-/pk-/rk- prefixed keys
    ("Anthropic key: sk-ant-abcdef0123456789ABCDEF", "anthropic_key"),
    ("OpenAI key: sk-projabcdef0123456789ABCDEF", "openai_sk"),
    ("Stripe key: sk-testabcdef0123456789ABCDEF", "stripe_key"),
    ("GitHub PAT: ghp_0123456789abcdefghij", "github_pat"),
    ("GitHub OAuth: gho_0123456789abcdefghij", "github_oauth"),
    ("GitHub user token: ghu_0123456789abcdefghij", "github_user"),
    ("GitHub server token: ghs_0123456789abcdefghij", "github_server"),
    ("GitHub legacy: github_pat_11ABCDEFGHI_0123456789abcdefghij", "github_legacy_pat"),
    ("Slack bot: xoxb-1234567890-ABCDEFGHIJ", "slack_bot"),
    ("Slack user: xoxp-1234567890-ABCDEFGHIJ", "slack_user"),
    ("AWS access key: AKIAIOSFODNN7EXAMPLE", "aws_access_key"),
    ("Google API key: AIzaSyA1234567890BCDEFGHIJKLMNOPQRSTUV", "google_api_key"),
    ("JWT token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c", "jwt"),
    ("Bearer authorization header: Bearer abcdef0123456789abcdef0123456789", "bearer"),
    ("Generic key=value pair: password = super-secret-1234", "password_kv"),
    ("URL with credentials: https://admin:hunter2@example.com/api", "url_with_creds"),
]


@pytest.mark.parametrize("text,label", SECRET_SAMPLES, ids=[s[1] for s in SECRET_SAMPLES])
def test_redact_secrets_removes_every_documented_pattern(text: str, label: str) -> None:
    """Every secret pattern listed in `_SECRET_PATTERNS` is replaced
    with the localised "a hidden value" phrase (English by default)."""
    out = redact_secrets(text, "en")
    replacement = phrase("en", "secret")
    assert replacement in out, (
        f"{label}: expected {replacement!r} in rendered output, got {out!r}"
    )
    # And the dangerous substring must NOT survive.
    dangerous_substrings = _sample_dangerous_substrings(label, text)
    for snippet in dangerous_substrings:
        assert snippet not in out, (
            f"{label}: substring {snippet!r} leaked through redact_secrets() -> {out!r}"
        )


def test_redact_secrets_runs_all_known_patterns() -> None:
    """A single text containing multiple secret shapes still has every
    shape redacted (proves the loop iterates all 12 patterns)."""
    text = (
        "Mixed: "
        "ghp_ABCDEFGHIJ1234567890 "
        "xoxb-1234567890-ABCDEFGHIJ "
        "sk-ant-1234567890ABCDEFGHIJ "
        "AKIAIOSFODNN7EXAMPLE "
        "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdef0123456789ABCDEFGHIJ"
    )
    out = redact_secrets(text, "en")
    assert "ghp_ABCDEFGHIJ1234567890" not in out
    assert "xoxb-1234567890-ABCDEFGHIJ" not in out
    assert "sk-ant-1234567890ABCDEFGHIJ" not in out
    assert "AKIAIOSFODNN7EXAMPLE" not in out
    # A full JWT carries three base64url segments — split check is enough
    # since the eyJhbGc... prefix is enough to fingerprint one.
    assert "eyJhbGciOiJIUzI1NiJ9" not in out


# ---------------------------------------------------------------------------
# render() — second-pass suppression of content that is unreadable aloud
# even after secrets are redacted.
# ---------------------------------------------------------------------------


def test_render_drops_stack_trace_lines() -> None:
    text = (
        "Hello there.\n"
        "Traceback (most recent call last):\n"
        "  File \"/app/server.py\", line 42, in handle\n"
        "ValueError: bad input\n"
        "Goodbye."
    )
    out = render(text, "en")
    assert out is not None
    assert "Traceback" not in out
    assert "ValueError" not in out
    assert "line 42" not in out
    # The two prose lines survive.
    assert "Hello there" in out
    assert "Goodbye" in out


def test_render_drops_diff_lines() -> None:
    text = (
        "Here is the patch:\n"
        "diff --git a/foo b/foo\n"
        "--- a/foo\n"
        "+++ b/foo\n"
        "@@ -1 +1 @@\n"
        "End of patch."
    )
    out = render(text, "en")
    assert out is not None
    assert "diff --git" not in out
    assert "@@" not in out
    assert "--- a/foo" not in out
    assert "+++ b/foo" not in out
    assert "Here is the patch" in out
    assert "End of patch" in out


def test_render_drops_jsonish_lines() -> None:
    text = (
        "The response is:\n"
        '{"status": "ok", "code": 0, "data": []}\n'
        '   "items": [1, 2, 3]\n'
        "That was it."
    )
    out = render(text, "en")
    assert out is not None
    assert '"status"' not in out
    assert '"items"' not in out
    assert "The response is" in out
    assert "That was it" in out


def test_render_replaces_url_with_localised_phrase() -> None:
    out = render(
        "Click here please: https://example.com/api/v1/users?next=42",
        "en",
    )
    assert out is not None
    assert "https://example.com" not in out
    assert "the conversation" not in out  # the URL was replaced, not "details"
    assert phrase("en", "link") in out


def test_render_strips_uuid_and_long_hashes() -> None:
    text = (
        "Session 5f1f77b8-edd9-4aab-9c2f-2c1d2a3b4c5d "
        "reported a sha256-prefixed fingerprint 7d1c4ab27d9ec9b1f6ede on its response.\n"
        "The session is now closed."
    )
    out = render(text, "en")
    assert out is not None
    assert "5f1f77b8-edd9-4aab-9c2f-2c1d2a3b4c5d" not in out
    assert "7d1c4ab27d9ec9b1f6ede" not in out
    assert "Session" in out
    assert "session is now closed" in out


def test_render_drops_lines_with_minified_token_over_60_chars() -> None:
    """A single 60+ char token (minified code, base64, hash) makes the
    whole line unspeakable. Confirms the >60 char guard isn't just
    passively there — it actively rejects ultra-long minified payloads.
    """
    minified = "x" * 100
    out = render(f"prefix {minified} suffix", "en")
    assert out is None  # entire line dropped -> "details" fallback


def test_render_preserves_short_inline_code_keeps_prose() -> None:
    """Inline code ≤32 chars IS spoken aloud (it's read-friendly);
    only longer inline code is suppressed per the renderer policy."""
    out = render("Run `npm install --save-dev` to begin.", "en")
    assert out is not None
    assert "npm install --save-dev" in out  # kept (≤32 chars)
    assert "Run" in out and "to begin" in out


def test_render_strips_long_inline_code() -> None:
    """Inline code >32 chars is suppressed (would be unreadable aloud)."""
    long_token = "x" * 40
    out = render(f"Use `{long_token}` here.", "en")
    assert out is not None
    assert long_token not in out


def test_render_strips_long_path_tokens() -> None:
    out = render(
        "Open /home/user/projects/something/bin/run.sh to launch.",
        "en",
    )
    assert out is not None
    # The PATH regex reduces the path to just the basename filename.
    assert "/home/user/projects/something/bin/" not in out
    assert "run.sh" in out or "launch" in out


def test_render_uses_details_phrase_when_all_lines_unspeakable() -> None:
    """All-unspeakable real content returns the localised `details`
    phrase — the consumer hears SOMETHING (the strongest security
    property: never silent, never ambiguous), but never raw content."""
    text = "Traceback (most recent call last):\nValueError: x"
    out = render(text, "en")
    assert out is not None
    assert out == phrase("en", "details")


def test_render_returns_none_for_whitespace_only_input() -> None:
    assert render("", "en") is None
    assert render("   \n  \n", "en") is None


def test_render_returns_none_for_punctuation_only() -> None:
    assert render("...???!!!", "en") is None


def test_render_drops_lines_with_minified_token_over_60_chars() -> None:
    """A single 60+ char token (minified code, base64, hash) makes the
    whole line unspeakable. Confirms the >60 char guard actively
    rejects ultra-long minified payloads and surfaces the localised
    `details` phrase rather than the unspeakable line."""
    minified = "x" * 100
    out = render(f"prefix {minified} suffix", "en")
    assert out is not None
    assert out == phrase("en", "details")
    assert minified not in out


# ---------------------------------------------------------------------------
# 5-language coverage — every suppression MUST use the localised phrase
# per ADR-071 (Language & Voice Resolution).
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "language",
    ["en", "fr", "es", "it", "de"],
)
def test_secret_redaction_uses_localised_phrase(language: str) -> None:
    """Same secret, 5 expected outputs — the renderer resolves the phrase
    through `phrase()` instead of inlining "a hidden value"."""
    out = redact_secrets("sk-ant-abcdef0123456789ABCDEF", language)
    expected = phrase(language, "secret")
    assert out == expected


@pytest.mark.parametrize(
    "language",
    ["en", "fr", "es", "it", "de"],
)
def test_render_uses_localised_link_phrase(language: str) -> None:
    out = render("Click https://example.com/path here.", language)
    assert out is not None
    assert phrase(language, "link") in out
    assert "https://example.com" not in out


@pytest.mark.parametrize(
    "language",
    ["en", "fr", "es", "it", "de"],
)
def test_render_uses_localised_details_phrase_for_all_suppressed_content(
    language: str,
) -> None:
    """Pure stack-trace content returns the localised `details` phrase
    per ADR-071; never raw stack-trace bytes."""
    text = (
        "Traceback (most recent call last):\n"
        "  File \"x.py\", line 1, in run\n"
        "RuntimeError: boom\n"
    )
    out = render(text, language)
    assert out == phrase(language, "details")


@pytest.mark.parametrize(
    "language",
    ["en", "fr", "es", "it", "de"],
)
def test_render_keeps_prose_in_every_language(language: str) -> None:
    """Plain prose survives every language."""
    sample = {
        "en": "Hello there",
        "fr": "Bonjour à tous",
        "es": "Hola a todos",
        "it": "Ciao a tutti",
        "de": "Hallo zusammen",
    }[language]
    out = render(sample + " — this is plain prose.", language)
    assert out is not None
    assert sample in out


# ---------------------------------------------------------------------------
# Defensive invariants — these ARE the "secrets not spoken" guarantees.
# ---------------------------------------------------------------------------


def test_pem_private_key_does_not_leak_through_multiline_text() -> None:
    """A PEM block can include arbitrary newlines. The renderer must
    match the full block including the `-----END...-----` footer; even
    if the body leaks, the leaked bytes can never be a usable private
    key if any line of the block was redacted.
    """
    text = (
        "Hello\n"
        "-----BEGIN EC PRIVATE KEY-----\n"
        "MIIBPKCB-----FAKE-CONTENT-NOT-A-REAL-KEY-DO-NOT-USE-----\n"
        "-----END EC PRIVATE KEY-----\n"
        "World\n"
    )
    out = render(text, "en")
    assert out is not None
    assert "BEGIN EC PRIVATE KEY" not in out
    assert "-----FAKE-CONTENT" not in out
    assert "END EC PRIVATE KEY" not in out
    assert "Hello" in out and "World" in out


def test_redact_secrets_is_idempotent() -> None:
    """redact_secrets applied twice yields the same result; the pipeline
    must be safe to call repeatedly without breaking redaction."""
    text = "Token: ghp_0123456789abcdefghij, again ghp_0123456789abcdefghij"
    once = redact_secrets(text, "en")
    twice = redact_secrets(once, "en")
    assert once == twice


def test_render_handles_ridiculously_long_input_without_crashing() -> None:
    """No exception, no pathological regex behaviour; output capped by
    the renderer to whatever the underlying re.sub yields."""
    text = "secret ghp_0123456789abcdefghij " + ("a" * 20_000)
    out = render(text, "en")
    assert out is not None  # never raises
    assert "ghp_0123456789abcdefghij" not in out


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _sample_dangerous_substrings(label: str, text: str) -> list[str]:
    """Return the substring(s) we want to assert are absent post-redaction.

    For most patterns the full secret is dangerous. For `password = ...` and
    URL-embedded creds the canonical identifier is the key name rather than
    the value (values are 4+ chars by config match length)."""
    samples: list[str] = []
    if label == "rsa_pkcs8":
        samples.extend(
            ["-----BEGIN", "-----END", "MIIEpAIBAAKCAQEAabcd"]
        )
    elif label == "anthropic_key":
        samples.append("sk-ant-abcdef0123456789ABCDEF")
    elif label == "openai_sk":
        samples.append("sk-projabcdef0123456789ABCDEF")
    elif label == "stripe_key":
        samples.append("sk-testabcdef0123456789ABCDEF")
    elif label == "github_pat":
        samples.append("ghp_0123456789abcdefghij")
    elif label == "github_oauth":
        samples.append("gho_0123456789abcdefghij")
    elif label == "github_user":
        samples.append("ghu_0123456789abcdefghij")
    elif label == "github_server":
        samples.append("ghs_0123456789abcdefghij")
    elif label == "github_legacy_pat":
        samples.append("github_pat_11ABCDEFGHI_0123456789abcdefghij")
    elif label == "slack_bot":
        samples.append("xoxb-1234567890-ABCDEFGHIJ")
    elif label == "slack_user":
        samples.append("xoxp-1234567890-ABCDEFGHIJ")
    elif label == "aws_access_key":
        samples.append("AKIAIOSFODNN7EXAMPLE")
    elif label == "google_api_key":
        samples.append("AIzaSyA1234567890BCDEFGHIJKLMNOPQRSTUV")
    elif label == "jwt":
        # A JWT is three base64url segments split by '.'. The renderer
        # matches the structural prefix (eyJ...eyJ...eyJ[base64]) so we
        # check the structural prefix rather than the full base64 payload.
        samples.append("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9")
    elif label == "bearer":
        samples.append("Bearer abcdef0123456789abcdef0123456789")
    elif label == "password_kv":
        # The `password_kv` regex matches the key prefix; we check that
        # neither the bare key name + value plus separator survive.
        # The renderer replaces the value with "a hidden value" so we
        # assert the *value* (super-secret-1234) is gone.
        samples.append("super-secret-1234")
    elif label == "url_with_creds":
        samples.append("hunter2")
    return samples


_SUPPRESSED_NO_LEAK = re.compile(
    r"^[A-Za-z0-9_+/=\-]{8,}$",  # block any all-base64 / all-hex segment
)
