# SPDX-License-Identifier: MIT
"""Integrity and failure-path checks for the qualified host launcher."""

from pathlib import Path
import hashlib
import tempfile
import unittest
from unittest.mock import patch

import mobile_host_cargo as host


class HostRuntimeTests(unittest.TestCase):
    def test_invalid_source_is_rejected_before_creating_runtime(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "source.so"
            source.write_bytes(b"unqualified")
            directory = Path(temporary) / "runtime"
            with self.assertRaisesRegex(RuntimeError, "Unqualified"):
                host.prepare_runtime(source, directory)
            self.assertFalse(directory.exists())

    def test_verified_fixture_is_accepted(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "source.so"
            source.write_bytes(b"approved fixture")
            with patch.object(host, "LIBRARY_SHA256", hashlib.sha256(source.read_bytes()).hexdigest()):
                host.verify_library(source)

    def test_existing_library_is_verified_without_overwriting(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "source.so"
            source.write_bytes(b"approved fixture")
            directory = Path(temporary) / "runtime"
            directory.mkdir()
            library = directory / host.LIBRARY_NAME
            library.write_bytes(b"unexpected cache")
            with patch.object(host, "LIBRARY_SHA256", hashlib.sha256(source.read_bytes()).hexdigest()), self.assertRaises(RuntimeError):
                host.prepare_runtime(source, directory)
            self.assertEqual(library.read_bytes(), b"unexpected cache")

    def test_unsupported_platform_does_not_launch_cargo(self):
        with patch.object(host.platform, "system", return_value="Windows"), patch.object(host.subprocess, "run") as run:
            with self.assertRaisesRegex(RuntimeError, "Linux x86_64"):
                host.main()
            run.assert_not_called()

    @unittest.skipUnless(host.platform.system() == "Linux", "Linux runtime symlinks")
    def test_preparation_preserves_runtime_and_selects_dynamic_linking(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "source.so"
            source.write_bytes(b"approved fixture")
            directory = Path(temporary) / "runtime"
            digest = hashlib.sha256(source.read_bytes()).hexdigest()
            with patch.object(host, "LIBRARY_SHA256", digest):
                environment = host.prepare_runtime(source, directory)
                self.assertEqual(host.prepare_runtime(source, directory), environment)
            self.assertEqual(environment["ORT_LIB_LOCATION"], str(directory))
            self.assertEqual(environment["ORT_PREFER_DYNAMIC_LINK"], "1")
            self.assertTrue(environment["LD_LIBRARY_PATH"].startswith(str(directory)))
            source.unlink()
            self.assertEqual((directory / "libonnxruntime.so.1").read_bytes(), b"approved fixture")


if __name__ == "__main__":
    unittest.main()
