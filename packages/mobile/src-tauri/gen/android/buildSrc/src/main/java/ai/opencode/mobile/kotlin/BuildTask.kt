import java.io.File
import org.apache.tools.ant.taskdefs.condition.Os
import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.logging.LogLevel
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.TaskAction

open class BuildTask : DefaultTask() {
    @Input
    var rootDirRel: String? = null
    @Input
    var target: String? = null
    @Input
    var release: Boolean? = null

    /** What the resolver actually looked at, for the error message. */
    private var searched: List<String> = emptyList()

    @TaskAction
    fun assemble() {
        val candidates = resolveCargoCandidates()
        searched = candidates
        if (candidates.isEmpty()) {
            throw GradleException(
                "Could not locate the cargo executable. Set CARGO_HOME, or put cargo " +
                    "on PATH, or pass -PcargoPath=<absolute path>. Working directory: " +
                    "${project.projectDir}"
            )
        }
        var firstFailure: Exception? = null
        for (candidate in candidates) {
            try {
                runCargoBuild(candidate)
                return
            } catch (exception: Exception) {
                // Keep the FIRST failure: it names the cargo we actually wanted,
                // whereas the previous chain rethrew the last one and reported
                // "cargo.bat", which is the least useful of the three.
                if (firstFailure == null) firstFailure = exception
            }
        }
        throw GradleException(
            "Found cargo at ${candidates.joinToString(", ")} but " +
                "`cargo build ${if (release == true) "--release " else ""}--target $target` failed.",
            firstFailure,
        )
    }

    /** Absolute paths first, bare name last. */
    private fun resolveCargoCandidates(): List<String> {
        val result = LinkedHashSet<String>()
        val cargoHome = System.getenv("CARGO_HOME")
        if (!cargoHome.isNullOrBlank()) {
            val exe = if (Os.isFamily(Os.FAMILY_WINDOWS)) "$cargoHome\\bin\\cargo.exe" else "$cargoHome/bin/cargo"
            if (File(exe).isFile) result.add(exe)
        }
        project.findProperty("cargoPath")?.toString()?.takeIf { it.isNotBlank() }?.let { result.add(it) }
        val path = System.getenv("PATH").orEmpty()
        val exts = if (Os.isFamily(Os.FAMILY_WINDOWS)) listOf(".exe", ".cmd", ".bat", "") else listOf("")
        for (dir in path.split(File.pathSeparatorChar)) {
            if (dir.isBlank()) continue
            for (ext in exts) {
                val candidate = File(dir, "cargo$ext")
                if (candidate.isFile) { result.add(candidate.absolutePath); break }
            }
            if (result.isNotEmpty()) break
        }
        // Last resort: let the OS resolve it (works only if the working
        // directory is the cargo directory, but costs nothing to try).
        result.add("cargo")
        return result.toList()
    }
    fun runCargoBuild(executable: String) {
        val rootDirRel = rootDirRel ?: throw GradleException("rootDirRel cannot be null")
        val target = target ?: throw GradleException("target cannot be null")
        val release = release ?: throw GradleException("release cannot be null")

        // WHY a direct `cargo build` and not `cargo tauri android android-studio-script`:
        // `android-studio-script` is an internal, hidden subcommand that reads its
        // options from a WebSocket served by Android Studio. Invoked from a plain
        // Gradle/CLI build there is nothing to connect to and tauri-cli panics with
        // `failed to read CLI options ... ConnectionRefused` (os error 10061). It is
        // not listed under `cargo tauri android --help` either. All this task
        // actually has to do is compile the native library for one target, which is
        // exactly what `cargo build --target <triple>` does, and it is immune to
        // CLI-internal refactors.
        val triple = targetTriple(target)
        val args = mutableListOf("build")
        // WHY custom-protocol on release: this is the feature that makes Tauri
        // serve the bundled frontend (tauri://localhost) rather than
        // `build.devUrl`. The Tauri CLI passes it for `tauri android build`;
        // since this task runs `cargo build` directly it must pass it too, or
        // a release APK silently boots in dev mode and the WebView requests
        // http://localhost:1430, where nothing listens, giving a black screen
        // with "Failed to send request".
        if (release) {
            args.add("--release")
            args.add("--features")
            args.add("custom-protocol")
        }
        args.add("--target")
        args.add(triple)

        val extraEnv = androidCrossEnv(triple)

        project.exec {
            workingDir(File(project.projectDir, rootDirRel))
            executable(executable)
            args(args)
            // Crates whose build script compiles C or assembly for the target
            // (`ring`, which this app pulls in, is one) need the NDK cross
            // compiler. `cargo tauri android build` exports these for us, but a
            // Gradle build started any other way does not, and the failure then
            // surfaces only as "failed to run custom build command for `ring`",
            // which says nothing about the missing linker. Set them here so the
            // task is self-sufficient, without overriding values the caller
            // already provided.
            environment(extraEnv)
            if (project.logger.isEnabled(LogLevel.DEBUG)) {
                args("-vv")
            } else if (project.logger.isEnabled(LogLevel.INFO)) {
                args("-v")
            }
        }.assertNormalExitValue()
    }

    /**
     * Cross-compilation environment for one Android target triple.
     *
     * Only variables that are not already set are returned, so a Tauri-driven
     * build keeps exactly the values Tauri chose, including its API level.
     */
    private fun androidCrossEnv(triple: String): Map<String, String> {
        if (!triple.endsWith("-linux-android") && !triple.endsWith("-linux-androideabi")) {
            return emptyMap()
        }
        val ndk = resolveNdk() ?: return emptyMap()
        val binDir = File(ndk, "toolchains/llvm/prebuilt/windows-x86_64/bin")
        if (!binDir.isDirectory) return emptyMap()

        val clangName = when (triple) {
            "aarch64-linux-android" -> "aarch64-linux-android24-clang"
            "armv7-linux-androideabi" -> "armv7a-linux-androideabi24-clang"
            "i686-linux-android" -> "i686-linux-android24-clang"
            "x86_64-linux-android" -> "x86_64-linux-android24-clang"
            else -> return emptyMap()
        }
        val clang = File(binDir, "$clangName.cmd").takeIf { it.isFile }
            ?: File(binDir, clangName).takeIf { it.isFile }
            ?: return emptyMap()
        val clangxx = File(binDir, "$clangName++.cmd").takeIf { it.isFile }
            ?: File(binDir, "$clangName++").takeIf { it.isFile }
        val ar = File(binDir, "llvm-ar.exe").takeIf { it.isFile }
            ?: File(binDir, "llvm-ar").takeIf { it.isFile }
        val ranlib = File(binDir, "llvm-ranlib.exe").takeIf { it.isFile }
            ?: File(binDir, "llvm-ranlib").takeIf { it.isFile }

        val env = LinkedHashMap<String, String>()
        val suffix = triple.uppercase().replace('-', '_')

        // Linking. The final link is driven by rustc, so the linker is found
        // through CARGO_TARGET_<TRIPLE>_LINKER.
        val linkerKey = "CARGO_TARGET_${suffix}_LINKER"
        if (System.getenv(linkerKey) == null) env[linkerKey] = clang.absolutePath
        val flagsKey = "CARGO_TARGET_${suffix}_RUSTFLAGS"
        if (System.getenv(flagsKey) == null) {
            env[flagsKey] = "-Clink-arg=-landroid -Clink-arg=-llog -Clink-arg=-lOpenSLES"
        }

        // Compiling. Crates with a build script that compiles C (this app pulls
        // in `ring`) go through the `cc` crate, which probes for a tool named
        // "<triple-without-api-level>-clang" - e.g. "aarch64-linux-android-clang".
        // The NDK only ships "aarch64-linux-android24-clang", so the probe fails
        // with ToolNotFound and the build script exits 1, surfacing as the
        // unhelpful "failed to run custom build command for `ring`". Setting
        // CC/CXX/AR/RANLIB per target makes the task self-sufficient.
        clangxx?.let { putIfUnset(env, "CXX_$suffix", it.absolutePath) }
        ar?.let { putIfUnset(env, "AR_$suffix", it.absolutePath) }
        ranlib?.let { putIfUnset(env, "RANLIB_$suffix", it.absolutePath) }
        putIfUnset(env, "CC_$suffix", clang.absolutePath)
        // `cc` normalises dashes to underscores, but also accepts the dashed
        // spelling; set both so either lookup finds the tool.
        putIfUnset(env, "CC_$triple", clang.absolutePath)

        if (System.getenv("NDK_HOME") == null) env["NDK_HOME"] = ndk
        return env
    }

    private fun putIfUnset(env: MutableMap<String, String>, key: String, value: String) {
        if (System.getenv(key) == null) env[key] = value
    }

    private fun resolveNdk(): String? {
        System.getenv("NDK_HOME")?.let { if (File(it).isDirectory) return it }
        System.getenv("ANDROID_NDK_HOME")?.let { if (File(it).isDirectory) return it }
        System.getenv("ANDROID_NDK_ROOT")?.let { if (File(it).isDirectory) return it }
        val sdk = System.getenv("ANDROID_HOME") ?: System.getenv("ANDROID_SDK_ROOT") ?: return null
        return File(sdk, "ndk").listFiles()
            ?.filter { File(it, "source.properties").isFile }
            ?.maxByOrNull { it.name }
            ?.absolutePath
    }

    /**
     * RustPlugin passes the short ABI name ("aarch64"); cargo needs the full
     * target triple. Unknown names fall through unchanged so a future Rust
     * target added to archList/targetList fails loudly at cargo rather than
     * being silently mapped to the wrong ABI.
     */
    private fun targetTriple(shortName: String): String = when (shortName) {
        "aarch64" -> "aarch64-linux-android"
        "armv7" -> "armv7-linux-androideabi"
        "i686" -> "i686-linux-android"
        "x86_64" -> "x86_64-linux-android"
        else -> shortName
    }
}