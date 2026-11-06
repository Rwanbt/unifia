package ai.unifia.mobile

import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class LlamaLoadStatusTest {
    @get:Rule val temp = TemporaryFolder()

    @Test fun failedLoadIsPublishedAndRetryClearsIt() {
        val root = temp.newFolder("runtime")
        val models = File(root, "models").apply { mkdirs() }
        val status = LlamaLoadStatus(File(models, "Spark-Q8_0.gguf").path)
        status.begin()
        status.finish(false, false, "unknown model architecture: 'spark2_5'")
        val marker = File(root, "llm_ipc/load_failure")
        assertEquals("Spark-Q8_0.gguf\nunknown model architecture: 'spark2_5'\n", marker.readText())
        status.begin()
        assertFalse(marker.exists())
    }

    @Test fun successAndBlockedDoNotPublishFailure() {
        val root = temp.newFolder("runtime")
        val models = File(root, "models").apply { mkdirs() }
        val status = LlamaLoadStatus(File(models, "model.gguf").path)
        status.finish(true, false, null)
        status.finish(false, true, null)
        assertFalse(File(root, "llm_ipc/load_failure").exists())
    }
}
