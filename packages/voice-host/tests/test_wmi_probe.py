# SPDX-License-Identifier: MIT
import platform
import sys
import unittest

from voice_host.worker import skip_wmi_platform_probe


@unittest.skipUnless(sys.platform == "win32", "WMI exists only on Windows")
class SkipWmiPlatformProbeTest(unittest.TestCase):
    def setUp(self) -> None:
        self.original = getattr(platform, "_wmi_query", None)
        platform._uname_cache = None  # type: ignore[attr-defined]

    def tearDown(self) -> None:
        if self.original is not None:
            platform._wmi_query = self.original  # type: ignore[attr-defined]
        platform._uname_cache = None  # type: ignore[attr-defined]

    def test_SkipWmiPlatformProbe_WmiQuery_RaisesOSError(self) -> None:
        skip_wmi_platform_probe()
        with self.assertRaises(OSError):
            platform._wmi_query("OS", "Version")  # type: ignore[attr-defined]

    def test_SkipWmiPlatformProbe_Machine_StillAnswersWithoutWmi(self) -> None:
        skip_wmi_platform_probe()
        self.assertIn(platform.machine(), {"AMD64", "ARM64", "x86"})
        self.assertTrue(platform.win32_ver()[0])


if __name__ == "__main__":
    unittest.main()
