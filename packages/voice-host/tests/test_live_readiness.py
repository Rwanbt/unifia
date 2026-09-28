import unittest

from voice_host.live.__main__ import initialize_local_models


class LocalModelInitializationTests(unittest.TestCase):
    def test_loads_both_required_models_before_live_readiness(self):
        initialized = []

        class Native:
            def init_vad(self):
                initialized.append("vad")

            def init_eot(self):
                initialized.append("eot")

        self.assertEqual(initialize_local_models(Native()), (True, True))
        self.assertEqual(initialized, ["vad", "eot"])

    def test_model_failure_is_reported_without_claiming_readiness(self):
        class Native:
            def init_vad(self):
                raise RuntimeError("private local path")

            def init_eot(self):
                pass

        self.assertEqual(initialize_local_models(Native()), (False, True))


if __name__ == "__main__":
    unittest.main()
