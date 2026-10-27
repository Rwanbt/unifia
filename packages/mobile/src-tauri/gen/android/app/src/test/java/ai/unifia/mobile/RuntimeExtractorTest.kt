package ai.unifia.mobile

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.ByteArrayInputStream
import java.io.File
import java.io.IOException
import java.io.InputStream

class RuntimeExtractorTest {

    @get:Rule
    val folder = TemporaryFolder()

    @Test
    fun `replaces the previous file and leaves no part file`() {
        val target = File(folder.root, "unifia-cli.js").apply { writeText("old bundle") }
        RuntimeExtractor.writeAtomically(ByteArrayInputStream("new bundle".toByteArray()), target)
        assertEquals("new bundle", target.readText())
        assertFalse(File(target.path + ".part").exists())
    }

    @Test
    fun `a copy that fails midway keeps the previous file and removes the part file`() {
        val target = File(folder.root, "unifia-cli.js").apply { writeText("old bundle") }
        val failing = object : InputStream() {
            private var sent = 0
            override fun read(): Int {
                if (sent++ < 4) return 'x'.code
                throw IOException("asset stream broke")
            }
        }
        try {
            RuntimeExtractor.writeAtomically(failing, target)
            fail("expected the copy to fail")
        } catch (expected: IOException) {
            assertEquals("asset stream broke", expected.message)
        }
        assertEquals("old bundle", target.readText())
        assertFalse(File(target.path + ".part").exists())
    }

    @Test
    fun `creates the target when none exists yet`() {
        val target = File(folder.root, "fresh.js")
        RuntimeExtractor.writeAtomically(ByteArrayInputStream("bundle".toByteArray()), target)
        assertEquals("bundle", target.readText())
    }
}
