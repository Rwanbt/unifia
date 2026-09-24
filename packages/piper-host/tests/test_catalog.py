import unittest

from piper_host.catalog import VOICES, VOICE_REVISION, resolve_voice


class PiperCatalogTests(unittest.TestCase):
    def test_all_required_languages_have_pinned_redistributable_voices(self):
        self.assertEqual(set(VOICES), {"en", "fr", "es", "it", "de"})
        for language, manifest in VOICES.items():
            with self.subTest(language=language):
                self.assertEqual(manifest.language, language)
                self.assertEqual(manifest.provider, "piper")
                self.assertEqual(manifest.model_version, VOICE_REVISION)
                self.assertTrue(manifest.redistributable)
                self.assertTrue(manifest.source.startswith("https://huggingface.co/"))
                self.assertTrue(manifest.license_source.startswith("https://"))
                self.assertEqual(len(manifest.model.sha256), 64)
                self.assertEqual(len(manifest.config.sha256), 64)
                self.assertIn(VOICE_REVISION, manifest.model.url)

    def test_provider_voice_id_must_match_selected_language(self):
        with self.assertRaises(ValueError):
            resolve_voice("fr", VOICES["en"].id)

    def test_existing_pocket_voice_id_resolves_to_language_fallback(self):
        self.assertEqual(resolve_voice("fr", "estelle").id, VOICES["fr"].id)


if __name__ == "__main__":
    unittest.main()
