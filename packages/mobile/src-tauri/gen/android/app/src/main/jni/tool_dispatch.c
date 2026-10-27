// SPDX-License-Identifier: MIT
// Native entry point for every <home>/.cache/wrappers/<tool> symlink.
//
// The wrappers used to be shell scripts with a `#!<nativeLibraryDir>/libbash_exec.so` shebang. The agent shell
// runs them as `libbash_exec.so <wrapper>`, but anything else (sh -c, make, npm, cargo, gcc) lets the kernel exec
// the script, and the untrusted_app SELinux policy refuses to execute a script from app data ("bad interpreter:
// Permission denied"). A symlink to this APK-extracted PIE executable is allowed to run, so the wrapper name now
// points here and this program hands the original script, kept in wrappers/.scripts/<tool>, to libbash_exec.so.
// Same pattern as libgit_dispatch.so for git's exec-path.
#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static const char *base_name(const char *path) {
    const char *slash = strrchr(path, '/');
    return slash ? slash + 1 : path;
}

// "/data/app/~~X==/ai.unifia.mobile-Y==/lib/arm64/libtool_dispatch.so" -> "ai.unifia.mobile".
static int derive_package(char *output, size_t size, const char *self) {
    const char *lib = strstr(self, "/lib/");
    if (!lib) return 0;
    const char *start = lib;
    while (start > self && *(start - 1) != '/') --start;
    const char *dash = NULL;
    for (const char *cursor = start; cursor < lib; ++cursor) {
        if (*cursor == '-') dash = cursor;
    }
    if (!dash || dash == start || (size_t)(dash - start) >= size) return 0;
    memcpy(output, start, (size_t)(dash - start));
    output[dash - start] = '\0';
    return 1;
}

int main(int argc, char **argv, char **envp) {
    if (argc < 1) return 126;

    char self[PATH_MAX];
    ssize_t length = readlink("/proc/self/exe", self, sizeof(self) - 1);
    if (length <= 0) {
        perror("tool dispatcher: readlink /proc/self/exe");
        return 126;
    }
    self[length] = '\0';

    char bash[PATH_MAX];
    char *slash = strrchr(self, '/');
    if (!slash || snprintf(bash, sizeof(bash), "%.*s/libbash_exec.so", (int)(slash - self), self) >= (int)sizeof(bash)) {
        fputs("tool dispatcher: cannot locate libbash_exec.so\n", stderr);
        return 126;
    }

    // The server and the rc files export the wrappers dir; tools that scrub the environment (git does for its
    // helpers) still land here, so fall back to the app's fixed data layout.
    char wrappers[PATH_MAX];
    const char *configured = getenv("UNIFIA_TOOL_WRAPPERS_DIR");
    if (configured && configured[0]) {
        snprintf(wrappers, sizeof(wrappers), "%s", configured);
    } else {
        char package[256];
        if (!derive_package(package, sizeof(package), self)) {
            fputs("tool dispatcher: cannot derive the app package\n", stderr);
            return 126;
        }
        snprintf(wrappers, sizeof(wrappers), "/data/user/0/%s/runtime/home/.cache/wrappers", package);
    }

    // A rootfs binary wrapped in place (gcc's cc1, collect2…: <name> links here, <name>.elf64 is the ELF) is
    // spawned by absolute path, so it is loaded straight through the musl linker, with the filtered library dir
    // and the SIGSYS -> ENOSYS shim (see toolchain.rs, seccomp_enosys.c).
    char elf[PATH_MAX];
    const char *rootfs_marker = strstr(argv[0], "/rootfs/");
    if (rootfs_marker && snprintf(elf, sizeof(elf), "%s.elf64", argv[0]) < (int)sizeof(elf) && access(elf, R_OK) == 0) {
        char runtime[PATH_MAX];
        char libraries[PATH_MAX];
        char linker[PATH_MAX];
        char shim[PATH_MAX];
        snprintf(runtime, sizeof(runtime), "%.*s", (int)(rootfs_marker - argv[0]), argv[0]);
        snprintf(libraries, sizeof(libraries), "%s/home/.cache/musl-lib", runtime);
        snprintf(linker, sizeof(linker), "%.*s/libmusl_linker.so", (int)(slash - self), self);
        snprintf(shim, sizeof(shim), "%.*s/libseccomp_enosys.so", (int)(slash - self), self);
        char **linker_argv = calloc((size_t)argc + 8, sizeof(char *));
        if (!linker_argv) {
            perror("tool dispatcher: calloc");
            return 126;
        }
        int next = 0;
        linker_argv[next++] = linker;
        linker_argv[next++] = "--library-path";
        linker_argv[next++] = libraries;
        // The program sees its own path, not <name>.elf64: clang re-executes argv[0] for -cc1, and that path is
        // this dispatcher symlink again, which the kernel allows; the .elf64 itself it would refuse.
        linker_argv[next++] = "--argv0";
        linker_argv[next++] = argv[0];
        if (access(shim, R_OK) == 0) {
            linker_argv[next++] = "--preload";
            linker_argv[next++] = shim;
        }
        linker_argv[next++] = elf;
        for (int index = 1; index < argc; ++index) linker_argv[next++] = argv[index];
        execve(linker, linker_argv, envp);
        fprintf(stderr, "tool dispatcher: execve %s failed: %s\n", linker, strerror(errno));
        free(linker_argv);
        return 126;
    }

    char script[PATH_MAX];
    const char *tool = base_name(argv[0]);
    if (snprintf(script, sizeof(script), "%s/.scripts/%s", wrappers, tool) >= (int)sizeof(script) ||
        access(script, R_OK) != 0) {
        fprintf(stderr, "%s: tool wrapper not found (%s)\n", tool, script);
        return 127;
    }

    char **bash_argv = calloc((size_t)argc + 2, sizeof(char *));
    if (!bash_argv) {
        perror("tool dispatcher: calloc");
        return 126;
    }
    bash_argv[0] = bash;
    bash_argv[1] = script;
    for (int index = 1; index < argc; ++index) bash_argv[index + 1] = argv[index];

    execve(bash, bash_argv, envp);
    fprintf(stderr, "tool dispatcher: execve %s failed: %s\n", bash, strerror(errno));
    free(bash_argv);
    return 126;
}
