import tempfile
import unittest
import wave
from pathlib import Path

from playback_trace_report import inspect, export


class PlaybackTraceTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory(prefix="voice-trace-test-")
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)
        self.pcm = bytes([1, 0, 254, 255])
        (self.root / "accepted-48000.pcm").write_bytes(self.pcm)
        self.manifest = (
            "voice-trace-v1\tpcm16le-mono\n"
            "mic-recording=false\ttime-us\tstage-or-metric\tbytes-or-value\n"
            "1\taccepted-48000.pcm\t4\n"
            "2\twrite-lock-wait-us\t120\n"
            "3\twrite-lock-wait-us\t30\n"
            "summary\tdropped-events\t0\n"
            "summary\tlimit-reached\tfalse\n"
        )
        self.save(self.manifest)

    def save(self, value):
        (self.root / "trace.tsv").write_text(value, encoding="utf-8")

    def test_same_pcm_is_exported_without_regeneration(self):
        report = inspect(self.root)
        self.assertEqual(report["maximum_metrics"]["write-lock-wait-us"], 120)
        self.assertEqual(report["recordings"][0]["frames"], 2)
        export(self.root, report)
        with wave.open(str(self.root / "accepted-48000.wav"), "rb") as wav:
            self.assertEqual(wav.getframerate(), 48000)
            self.assertEqual(wav.readframes(2), self.pcm)
        with self.assertRaises(FileExistsError):
            export(self.root, report)

    def test_loss_limits_and_unfinished_capture_are_rejected(self):
        for manifest in [self.manifest.replace("dropped-events\t0", "dropped-events\t1"),
                         self.manifest.replace("limit-reached\tfalse", "limit-reached\ttrue"),
                         self.manifest.split("summary")[0],
                         self.manifest.replace("summary\tdropped-events", "4\tnative-trace-dropped-samples\t1\nsummary\tdropped-events")]:
            with self.subTest(manifest=manifest):
                self.save(manifest)
                with self.assertRaises(ValueError):
                    inspect(self.root)

    def test_pcm_corruption_and_unsafe_paths_are_rejected(self):
        for manifest in [self.manifest.replace(".pcm\t4", ".pcm\t6"),
                         self.manifest.replace(".pcm\t4", ".pcm\t3"),
                         self.manifest.replace("accepted-48000.pcm", "../accepted-48000.pcm"),
                         self.manifest.replace(".pcm\t4", ".pcm\t999999999"),
                         self.manifest + "summary\tdropped-events\t0\n",
                         self.manifest.replace("voice-trace-v1", "voice-trace-v99")]:
            with self.subTest(manifest=manifest):
                self.save(manifest)
                with self.assertRaises(ValueError):
                    inspect(self.root)


if __name__ == "__main__":
    unittest.main()
