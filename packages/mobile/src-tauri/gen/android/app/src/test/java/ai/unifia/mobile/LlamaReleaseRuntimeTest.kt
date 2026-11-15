package ai.unifia.mobile

import java.io.File
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class LlamaReleaseRuntimeTest {
    @get:Rule val temp = TemporaryFolder()

    @Test fun explicitDeviceSelectionNeverSilentlySubstitutesCpu() {
        assertEquals("GPUOpenCL", llamaReleaseDevice("OPENCL"))
        assertEquals("HTP0", llamaReleaseDevice("HEXAGON"))
        assertEquals("none", llamaReleaseDevice("CPU"))
        try {
            llamaReleaseDevice("VULKAN")
            fail("A Snapdragon distribution cannot satisfy a Vulkan request")
        } catch (error: IllegalArgumentException) {
            assertTrue(error.message!!.contains("matching GPU build"))
        }
    }

    @Test fun smallRealElfLauncherIsAcceptedButMissingCompanionsAreNot() {
        val dir = temp.newFolder("jni")
        val elf = ByteArray(7472)
        byteArrayOf(0x7f, 0x45, 0x4c, 0x46).copyInto(elf)
        for (name in listOf("libllama_server.so", "libllama-server-impl.so", "libllama-common.so", "libggml-opencl.so")) {
            File(dir, name).writeBytes(elf)
        }
        assertTrue(isLlamaReleaseRuntime(dir.path))
        assertTrue(hasLlamaReleaseBackend(dir.path, "OPENCL"))
        assertFalse(hasLlamaReleaseBackend(dir.path, "HEXAGON"))
        assertTrue(File(dir, "libllama-common.so").delete())
        assertFalse(hasLlamaReleaseBackend(dir.path, "OPENCL"))
    }
}
