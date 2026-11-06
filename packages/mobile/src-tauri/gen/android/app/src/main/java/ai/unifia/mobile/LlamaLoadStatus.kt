package ai.unifia.mobile

import java.io.File

internal class LlamaLoadStatus(modelPath: String) {
    private val model = File(modelPath).name
    private val dir = File(modelPath).parentFile?.parentFile?.let { File(it, "llm_ipc") }
    private val failure = dir?.let { File(it, "load_failure") }

    fun begin() {
        if (failure?.exists() == true && !failure.delete()) error("Could not clear previous model load failure")
    }

    fun finish(ok: Boolean, blocked: Boolean, detail: String?) {
        if (ok || blocked || failure == null || dir == null) return
        if (!dir.exists() && !dir.mkdirs()) error("Could not create model status directory")
        val safeModel = model.replace('\n', ' ').replace('\r', ' ')
        val safeDetail = (detail ?: "The local inference engine failed to load the model")
            .replace('\n', ' ').replace('\r', ' ')
        val tmp = File(dir, "load_failure.tmp")
        tmp.writeText("$safeModel\n$safeDetail\n")
        if (!tmp.renameTo(failure)) error("Could not publish model load failure")
    }
}
