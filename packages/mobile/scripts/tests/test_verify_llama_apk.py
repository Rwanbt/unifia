import os
import pathlib
import subprocess
import tempfile
import unittest
import zipfile

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / 'verify-llama-apk.sh'
LIBS = ('libllama_server.so', 'libllama.so', 'libggml.so', 'libggml-base.so', 'libggml-cpu.so')
BASH = os.environ.get('BASH', 'bash')

class PackagedLlamaTests(unittest.TestCase):
    def test_rejects_changed_and_missing_library(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            libs = root / 'packages/mobile/src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a'
            libs.mkdir(parents=True)
            for name in LIBS:
                (libs / name).write_bytes(name.encode())
            apk = root / 'app.apk'
            def run(changed=None, missing=None):
                with zipfile.ZipFile(apk, 'w') as archive:
                    for name in LIBS:
                        if name != missing:
                            archive.writestr('lib/arm64-v8a/' + name, b'bad' if name == changed else name.encode())
                return subprocess.run([BASH, str(SCRIPT), str(apk)], cwd=root, capture_output=True).returncode
            self.assertEqual(run(), 0)
            self.assertNotEqual(run(changed=LIBS[0]), 0)
            self.assertNotEqual(run(missing=LIBS[0]), 0)

if __name__ == '__main__':
    unittest.main()
