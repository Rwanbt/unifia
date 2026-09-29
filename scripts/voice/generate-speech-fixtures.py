#!/usr/bin/env python3
"""Generate the cross-runtime SpeechSegmenter/SpeechRenderer parity fixture.

The Python reference implementation under ``packages/voice-host/voice_host/live``
is the source of truth. The TypeScript ports
(``packages/app/src/voice/speech-segmenter.ts`` and ``speech-renderer.ts``)
must reproduce its output exactly; both suites assert against the JSON this
script writes to ``packages/voice-core/fixtures/speech-text-parity.json``.

Re-run this script only after a deliberate reference change, then re-run
``tests/test_text_parity.py`` (Voice Host) and ``speech-text-parity.test.ts``
(app) so both sides prove parity against the same bytes.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "packages" / "voice-host"))

from voice_host.live.renderer import PHRASES, phrase, redact_secrets, render  # noqa: E402
from voice_host.live.segmenter import SpeechSegmenter  # noqa: E402

OUT = ROOT / "packages" / "voice-core" / "fixtures" / "speech-text-parity.json"

SEGMENTER_CASES: list[tuple[str, list[str]]] = [
    ("first_sentence_before_answer_ends", ["Sure", ".", " Let me check"]),
    ("sentence_boundaries_not_char_counts", ["I fixed the failing test in the parser module. ", "It was an off-by-one error in the loop. Done."]),
    ("decimals_and_abbreviations", ["Version 3.5 uses about 2.4 GB, e.g. on Linux. That is fine.", " Dr Martin agreed."]),
    ("single_letter_abbreviation", ["Merci M", ". Dupont pour votre aide.", " À bientôt."]),
    ("code_fence_marker", ["Here is the fix:\n```ts\nconst a = 1\n", "console.log(a)\n```\nIt works now."]),
    ("tilde_fence_and_paragraph", ["Avant\n~~~\nprint(1)\n~~~\nAprès le bloc."]),
    ("long_list_summarised", ["Changes:\n"] + [f"- item number {index}\n" for index in range(9)] + ["End."]),
    ("five_items_then_prose", ["Liste :\n"] + [f"- point {index}\n" for index in range(5)] + ["Fin de la liste."]),
    ("table_reported_once", ["| a | b |\n|---|---|\n| 1 | 2 |\nAfter the table."]),
    ("clause_cut_long_run", [("word " * 30 + ", ") + ("more " * 40)]),
    ("paragraph_break_release", ["Un premier paragraphe assez long.", "\n\n", "Deuxième paragraphe qui suit."]),
    ("merge_short_sentences", ["Oui.", " Non, ce n'est pas possible", " pour le moment."]),
    ("french_stream_splits", ["Bonjour", ". ", "Comment allez-vous ", "aujourd'hui ? ", "Très bien, ", "merci de votre réponse."]),
    ("mid_word_deltas", ["Les test", "s du module de conn", "exion passent enfin. ", "Tout est vert."]),
    ("single_sentence_answer", ["Bonjour à tous"]),
    ("full_text_single_push", ["Bonjour à tous. Voici la réponse complète."]),
    ("empty_stream", []),
    ("whitespace_only", ["   ", "  \t "]),
    ("german_and_accents", ["Die Daten sind bereit. Können Sie das bitte prüfen?", " Ja, das geht."]),
    ("link_in_prose", ["Siehe https://example.com/a/b für Details.", " Sonst nichts."]),
]

RENDER_CASES: list[tuple[str, str, str]] = [
    ("secret_sk_ant", "en", "The value is sk-ant-abcdefghijklmnopqrstuvwxyz0123 now."),
    ("secret_github_token", "en", "The value is ghp_abcdefghijklmnopqrstuvwxyz0123456789 now."),
    ("secret_aws_key", "en", "The value is AKIAABCDEFGHIJKLMNOP now."),
    ("secret_password", "en", "The value is password: hunter2hunter2 now."),
    ("secret_bearer", "en", "The value is Bearer abcdefghijklmnopqrstuvwxyz now."),
    ("secret_url_credentials", "en", "The value is https://user:pa55word@example.com/repo now."),
    ("secret_french_phrase", "fr", "La clé est sk-ant-abcdefghijklmnopqrstuvwxyz0123 ici."),
    ("private_key_block", "en", "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkq\n-----END PRIVATE KEY-----"),
    ("urls_paths_hashes", "en", "See https://example.com/a/b and packages/app/src/foo.ts at 0a1b2c3d4e5f6a7b."),
    ("markdown_flattened", "en", "## **Done**: `bun test` passes"),
    ("french_markdown", "fr", "## **Résultat** : `bun test` passe."),
    ("stack_trace", "en", "  at Object.run (file.ts:10:3)"),
    ("json_object", "en", '{"key": "value", "n": 1}'),
    ("diff_header", "en", "@@ -1,3 +1,4 @@"),
    ("long_numbers_kept", "en", "It costs 123456789012 euros."),
    ("table_pipe_text", "en", "| a | b |\n|---|---|\n| 1 | 2 |"),
    ("empty_input", "en", ""),
    ("whitespace_input", "en", "   "),
    ("unicode_accents", "fr", "Les données sont prêtes — vérifiez le fichier."),
    ("long_inline_code", "en", "Run `npm install --save-dev some-really-long-package-name-exceeding` now"),
    ("uuid_removed", "en", "Session ses_1 vs 550e8400-e29b-41d4-a716-446655440000 done."),
    ("markdown_link", "en", "See [the docs](https://example.com/docs) for more."),
    ("list_marker_stripped", "en", "- install the dependencies\n- run the tests"),
    ("html_tags_removed", "en", "<p>Hello <strong>world</strong></p>"),
]

REDACT_CASES: list[tuple[str, str, str]] = [
    ("sk_ant_en", "en", "sk-ant-abcdefghijklmnopqrstuvwxyz0123"),
    ("sk_ant_fr", "fr", "sk-ant-abcdefghijklmnopqrstuvwxyz0123"),
    ("private_key_en", "en", "-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----"),
    ("password_and_api_key", "en", "token=abcdefghijklmnop and api_key: zzzzzzzzzzzz"),
    ("jwt_en", "en", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N3xlFm2WKpj"),
    ("ftp_credentials", "en", "ftp://alice:s3cr3t@ftp.example.com/pub"),
    ("google_api_key", "en", "AIzaSyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
    # Keep this vector shaped like the already-accepted synthetic examples in
    # voice_host tests: GitHub push protection blocks the full real-token
    # shape (two digit groups + long suffix) even when obviously fake.
    ("slack_token", "en", "xoxb-1234567890-ABCDEFGHIJ"),
    ("github_fine_grained_pat", "en", "github_pat_11ABCDEFG00000000000000000000000000"),
    ("sentence_with_secret", "fr", "Le mot de passe est password: hunter2hunter2, compris ?"),
]

PHRASE_KEYS = ("code", "table", "list_rest", "link", "secret", "details", "working", "permission", "error")


def segment_dict(segment) -> dict[str, object]:
    return {"kind": segment.kind, "text": segment.text, "count": segment.count}


def run_segmenter(name: str, deltas: list[str]) -> dict[str, object]:
    segmenter = SpeechSegmenter()
    steps = []
    for delta in deltas:
        steps.append({"delta": delta, "segments": [segment_dict(s) for s in segmenter.push(delta)]})
    return {"name": name, "steps": steps, "flush": [segment_dict(s) for s in segmenter.flush()]}


def main() -> int:
    fixture = {
        "version": 1,
        "source": "scripts/voice/generate-speech-fixtures.py",
        "reference": "packages/voice-host/voice_host/live",
        "segmenter": [run_segmenter(name, deltas) for name, deltas in SEGMENTER_CASES],
        "render": [
            {"name": name, "language": language, "input": text, "output": render(text, language)}
            for name, language, text in RENDER_CASES
        ],
        "redact": [
            {"name": name, "language": language, "input": text, "output": redact_secrets(text, language)}
            for name, language, text in REDACT_CASES
        ],
        "phrases": [
            {"language": language, "key": key, "values": values, "output": phrase(language, key, **values)}
            for language in PHRASES
            for key in PHRASE_KEYS
            for values in ([{"count": 3}] if key == "list_rest" else [{}])
        ],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(fixture, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
