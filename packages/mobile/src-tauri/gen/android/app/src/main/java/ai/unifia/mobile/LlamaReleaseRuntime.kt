package ai.unifia.mobile

import java.io.File

/** Official v1 uses a small PIE launcher and shared implementations, not per-backend executables. */
internal fun isLlamaReleaseRuntime(dir: String?): Boolean =
    dir != null && File(dir, "libllama-server-impl.so").isFile

internal fun llamaReleaseDevice(backend: String): String = when (backend) {
    "OPENCL" -> "GPUOpenCL"
    "HEXAGON" -> "HTP0"
    "CPU" -> "none"
    else -> throw IllegalArgumentException("The official Snapdragon bundle does not provide $backend; a matching GPU build is required")
}

internal fun hasLlamaReleaseBackend(dir: String, backend: String): Boolean {
    val required = when (backend) {
        "OPENCL" -> listOf("libggml-opencl.so")
        "HEXAGON" -> listOf("libggml-hexagon.so")
        else -> return false
    }
    val files = listOf("libllama_server.so", "libllama-server-impl.so", "libllama-common.so") + required
    return files.all { name ->
        val file = File(dir, name)
        file.isFile && file.length() >= 64 && file.inputStream().use { stream ->
            val magic = ByteArray(4)
            stream.read(magic) == 4 && magic.contentEquals(byteArrayOf(0x7f, 0x45, 0x4c, 0x46))
        }
    } && (backend != "HEXAGON" || listOf(73, 75, 79, 81, 85).any { arch ->
        File(dir, "libggml-htp-v$arch.so").let { it.isFile && it.length() > 10_000 }
    })
}
