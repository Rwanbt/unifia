import unittest

from voice_host.live.language import LanguageRouter, detect_language, is_language_neutral, normalize_language
from voice_host.live.renderer import phrase, redact_secrets, render
from voice_host.live.segmenter import MAX_CHARS, MAX_LIST_ITEMS, SpeechSegmenter


def run(deltas):
    segmenter = SpeechSegmenter()
    out = []
    for delta in deltas:
        out.extend(segmenter.push(delta))
    out.extend(segmenter.flush())
    return out


class SegmenterTests(unittest.TestCase):
    def test_first_sentence_is_released_before_the_answer_ends(self):
        segmenter = SpeechSegmenter()
        self.assertEqual(segmenter.push("Sure"), [])
        self.assertEqual(segmenter.push("."), [])  # "3." could still become "3.5"
        released = segmenter.push(" Let me check")
        self.assertEqual([s.text for s in released], ["Sure."])

    def test_segments_follow_sentence_boundaries_not_character_counts(self):
        segments = run(["I fixed the failing test in the parser module. ", "It was an off-by-one error in the loop. Done."])
        self.assertEqual(
            [s.text for s in segments],
            ["I fixed the failing test in the parser module.", "It was an off-by-one error in the loop. Done."],
        )

    def test_decimals_versions_and_abbreviations_do_not_split(self):
        segments = run(["Version 3.5 uses about 2.4 GB, e.g. on Linux. That is fine."])
        self.assertEqual(segments[0].text, "Version 3.5 uses about 2.4 GB, e.g. on Linux.")

    def test_code_fence_becomes_one_marker_and_is_never_spoken(self):
        segments = run(["Here is the fix:\n```ts\nconst a = 1\n", "console.log(a)\n```\nIt works now."])
        kinds = [s.kind for s in segments]
        self.assertEqual(kinds.count("code"), 1)
        self.assertNotIn("console.log", " ".join(s.text for s in segments))
        self.assertEqual(segments[-1].text, "It works now.")

    def test_long_lists_are_summarised(self):
        items = "".join(f"- item number {i}\n" for i in range(9))
        segments = run(["Changes:\n", items, "End."])
        prose = [s for s in segments if s.kind == "prose" and s.text.startswith("- item")]
        self.assertEqual(len(prose), MAX_LIST_ITEMS)
        rest = [s for s in segments if s.kind == "list_rest"]
        self.assertEqual(rest[0].count, 9 - MAX_LIST_ITEMS)

    def test_tables_are_reported_once(self):
        segments = run(["| a | b |\n|---|---|\n| 1 | 2 |\nAfter."])
        self.assertEqual([s.kind for s in segments].count("table"), 1)

    def test_run_on_text_is_cut_at_a_clause(self):
        text = ("word " * 30 + ", ") + ("more " * 40)
        segments = run([text])
        self.assertTrue(all(len(s.text) <= MAX_CHARS for s in segments))
        self.assertGreater(len(segments), 1)


class RendererTests(unittest.TestCase):
    def test_secrets_are_never_spoken(self):
        for secret in (
            "sk-ant-abcdefghijklmnopqrstuvwxyz0123",
            "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
            "AKIAABCDEFGHIJKLMNOP",
            "password: hunter2hunter2",
            "Bearer abcdefghijklmnopqrstuvwxyz",
            "https://user:pa55word@example.com/repo",
        ):
            spoken = render(f"The value is {secret} now.", "en") or ""
            self.assertNotIn(secret, spoken)
            self.assertNotIn("hunter2", spoken)
            self.assertNotIn("pa55word", spoken)

    def test_private_key_block_is_redacted(self):
        text = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkq\n-----END PRIVATE KEY-----"
        self.assertNotIn("MIIEvQ", redact_secrets(text, "en"))

    def test_urls_paths_and_hashes_are_reduced(self):
        spoken = render("See https://example.com/a/b and packages/app/src/foo.ts at 0a1b2c3d4e5f6a7b.", "en")
        self.assertEqual(spoken, "See a link and foo.ts at.")

    def test_markdown_is_flattened(self):
        self.assertEqual(render("## **Done**: `bun test` passes", "en"), "Done: bun test passes")

    def test_stack_traces_json_and_diffs_are_not_read(self):
        self.assertEqual(render('  at Object.run (file.ts:10:3)', "en"), phrase("en", "details"))
        self.assertEqual(render('{"key": "value", "n": 1}', "en"), phrase("en", "details"))
        self.assertEqual(render("@@ -1,3 +1,4 @@", "en"), phrase("en", "details"))

    def test_phrases_exist_for_every_language(self):
        for language in ("en", "fr", "es", "it", "de"):
            self.assertTrue(phrase(language, "code"))
            self.assertIn("3", phrase(language, "list_rest", count=3))

    def test_long_numbers_are_kept(self):
        self.assertEqual(render("It costs 123456789012 euros.", "en"), "It costs 123456789012 euros.")


class LanguageTests(unittest.TestCase):
    def test_normalize(self):
        self.assertEqual(normalize_language("fr-FR"), "fr")
        self.assertIsNone(normalize_language("pt"))

    def test_technical_words_are_neutral(self):
        for text in ("OK", "GitHub", "README", "npm build", "run the tests"[:0] or "bun test"):
            self.assertTrue(is_language_neutral(text), text)

    def test_detects_full_sentences(self):
        self.assertEqual(detect_language("Corrige l'erreur dans le module de connexion pour moi"), "fr")
        self.assertEqual(detect_language("Please fix the error in the login module"), "en")
        self.assertEqual(detect_language("Kannst du bitte die Tests für mich ausführen"), "de")
        self.assertEqual(detect_language("Puedes arreglar el error de la página por favor"), "es")
        self.assertEqual(detect_language("Puoi correggere il test che non funziona"), "it")
        self.assertIsNone(detect_language("npm build"))

    def test_explicit_preference_wins(self):
        router = LanguageRouter(preference="de")
        self.assertEqual(router.resolve("fr", "Bonjour tout le monde, comment allez vous"), "de")

    def test_short_utterances_do_not_flip_the_conversation(self):
        router = LanguageRouter(application_locale="fr-FR")
        self.assertEqual(router.resolve("fr", "Corrige le test qui échoue dans le parseur"), "fr")
        self.assertEqual(router.resolve("en", "OK"), "fr")
        self.assertEqual(router.resolve("en", "GitHub README"), "fr")

    def test_a_full_sentence_switches_language(self):
        router = LanguageRouter()
        router.resolve("fr", "Corrige le test qui échoue dans le parseur")
        self.assertEqual(router.resolve("en", "Now please explain what you changed in the parser"), "en")

    def test_fallback_order(self):
        self.assertEqual(LanguageRouter(application_locale="it-IT").resolve(None), "it")
        self.assertEqual(LanguageRouter(application_locale="pt-BR").resolve(None), "en")


if __name__ == "__main__":
    unittest.main()
