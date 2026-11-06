import pathlib
import shutil
import subprocess
import tempfile
import unittest

SOURCE = pathlib.Path(__file__).resolve().parents[1] / "llama-provenance.mjs"
LIBS = ("libllama_server.so", "libllama.so", "libggml.so", "libggml-base.so", "libggml-cpu.so")

class ProvenanceTests(unittest.TestCase):
    def test_stale_revision_and_changed_library_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            scripts = root / "scripts"
            scripts.mkdir()
            script = scripts / SOURCE.name
            shutil.copyfile(SOURCE, script)
            revision = root / "llama-cpp-revision.txt"
            revision.write_text("a" * 40)
            libs = root / "src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a"
            libs.mkdir(parents=True)
            for name in LIBS:
                (libs / name).write_bytes(name.encode())
            def run(mode):
                return subprocess.run(["node", str(script), mode], capture_output=True).returncode
            self.assertEqual(run("write"), 0)
            self.assertEqual(run("check"), 0)
            (libs / LIBS[0]).write_bytes(b"changed")
            self.assertNotEqual(run("check"), 0)
            (libs / LIBS[0]).write_bytes(LIBS[0].encode())
            revision.write_text("b" * 40)
            self.assertNotEqual(run("check"), 0)
            revision.write_text("a" * 40)
            (libs / "libllama_server_opencl.so").write_bytes(b"unknown version")
            self.assertNotEqual(run("check"), 0)

if __name__ == "__main__":
    unittest.main()
