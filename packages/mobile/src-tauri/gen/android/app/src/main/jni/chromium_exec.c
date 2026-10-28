/* SPDX-License-Identifier: MIT */
/*
 * Preloaded into the rootfs Chromium (and the Node that drives it) by the Browser host on Android.
 *
 * Rootfs programs run through the musl linker because Android refuses to execve a file from app data. Two
 * things break for Chromium:
 *   - /proc/self/exe is the linker, and Chromium finds its .pak files, V8 snapshot and crashpad handler next
 *     to it. readlink("/proc/self/exe") answers argv[0] instead, which the linker sets with --argv0.
 *   - it starts its children (and Node starts Chromium) with execve/posix_spawn on a rootfs path, which the
 *     kernel refuses. Those calls are rewritten into "<linker> ... <program>".
 *
 * Built by the NDK but loaded into musl processes: it includes no libc header and links no libc, every
 * libc symbol below resolves against musl at load time. Only the ABI-identical parts of musl are used:
 * RTLD_NEXT is musl's value, not Bionic's, and the posix_spawn structures are only passed through.
 *
 * Environment (set by packages/unifia/src/browser/android-host-runtime.ts):
 *   UNIFIA_ROOTFS             programs under this prefix are started through the linker
 *   UNIFIA_MUSL_LINKER        the musl linker in nativeLibraryDir
 *   UNIFIA_MUSL_LIBRARY_PATH  --library-path for the child
 *   UNIFIA_MUSL_PRELOAD       --preload for the child (this library and the seccomp shim)
 */

typedef unsigned long size_t;
typedef long ssize_t;
typedef int pid_t;

#define MUSL_RTLD_NEXT ((void *)-1)
#define MAX_EXTRA_ARGUMENTS 9

extern char **environ;
extern char *program_invocation_name;
void *dlsym(void *handle, const char *symbol);
char *getenv(const char *name);
void *calloc(size_t count, size_t size);
void free(void *pointer);
size_t strlen(const char *text);
int strcmp(const char *left, const char *right);
int strncmp(const char *left, const char *right, size_t count);
char *strchr(const char *text, int character);
void *memcpy(void *destination, const void *source, size_t count);

static const char SELF_EXE[] = "/proc/self/exe";

static int starts_with(const char *text, const char *prefix) {
    return text && prefix && strncmp(text, prefix, strlen(prefix)) == 0;
}

/* Returns the length written, or -2 when the call is not about /proc/self/exe of a rootfs program. */
static ssize_t self_exe(const char *path, char *buffer, size_t size) {
    if (!path || strcmp(path, SELF_EXE) != 0) return -2;
    const char *self = program_invocation_name;
    if (!starts_with(self, getenv("UNIFIA_ROOTFS"))) return -2;
    size_t length = strlen(self);
    if (length > size) length = size;
    memcpy(buffer, self, length);
    return (ssize_t)length;
}

ssize_t readlink(const char *path, char *buffer, size_t size) {
    ssize_t answered = self_exe(path, buffer, size);
    if (answered != -2) return answered;
    static ssize_t (*real)(const char *, char *, size_t);
    if (!real) real = dlsym(MUSL_RTLD_NEXT, "readlink");
    return real(path, buffer, size);
}

ssize_t readlinkat(int directory, const char *path, char *buffer, size_t size) {
    ssize_t answered = self_exe(path, buffer, size);
    if (answered != -2) return answered;
    static ssize_t (*real)(int, const char *, char *, size_t);
    if (!real) real = dlsym(MUSL_RTLD_NEXT, "readlinkat");
    return real(directory, path, buffer, size);
}

/* [linker --library-path L --preload P --argv0 A program argv[1..]], or 0 when path is not a rootfs program. */
static char **through_linker(const char *path, char *const argv[]) {
    const char *root = getenv("UNIFIA_ROOTFS");
    const char *linker = getenv("UNIFIA_MUSL_LINKER");
    /* Chromium starts its children through the literal /proc/self/exe, which is the linker here. */
    if (path && strcmp(path, SELF_EXE) == 0) path = program_invocation_name;
    if (!linker || !starts_with(path, root)) return 0;
    const char *libraries = getenv("UNIFIA_MUSL_LIBRARY_PATH");
    const char *preload = getenv("UNIFIA_MUSL_PRELOAD");
    int argc = 0;
    while (argv && argv[argc]) argc++;
    char **rewritten = calloc((size_t)argc + MAX_EXTRA_ARGUMENTS, sizeof(char *));
    if (!rewritten) return 0;
    int next = 0;
    rewritten[next++] = (char *)linker;
    if (libraries) { rewritten[next++] = "--library-path"; rewritten[next++] = (char *)libraries; }
    if (preload) { rewritten[next++] = "--preload"; rewritten[next++] = (char *)preload; }
    /* The child learns its own path from argv[0] (see self_exe), so it must never be /proc/self/exe. */
    rewritten[next++] = "--argv0";
    rewritten[next++] = (char *)(argc > 0 && strcmp(argv[0], SELF_EXE) != 0 ? argv[0] : path);
    rewritten[next++] = (char *)path;
    for (int index = 1; index < argc; index++) rewritten[next++] = argv[index];
    return rewritten;
}

int execve(const char *path, char *const argv[], char *const envp[]) {
    static int (*real)(const char *, char *const[], char *const[]);
    if (!real) real = dlsym(MUSL_RTLD_NEXT, "execve");
    char **rewritten = through_linker(path, argv);
    if (rewritten) return real(rewritten[0], rewritten, envp);
    return real(path, argv, envp);
}

int execv(const char *path, char *const argv[]) { return execve(path, argv, environ); }

/* Rootfs programs are always started by absolute path; a bare name keeps the real PATH lookup. */
int execvp(const char *file, char *const argv[]) {
    if (file && strchr(file, '/')) return execve(file, argv, environ);
    static int (*real)(const char *, char *const[]);
    if (!real) real = dlsym(MUSL_RTLD_NEXT, "execvp");
    return real(file, argv);
}

typedef int (*spawn_fn)(pid_t *, const char *, const void *, const void *, char *const[], char *const[]);

int posix_spawn(pid_t *pid, const char *path, const void *actions, const void *attributes, char *const argv[],
                char *const envp[]) {
    static spawn_fn real;
    if (!real) real = (spawn_fn)dlsym(MUSL_RTLD_NEXT, "posix_spawn");
    char **rewritten = through_linker(path, argv);
    if (!rewritten) return real(pid, path, actions, attributes, argv, envp);
    int result = real(pid, rewritten[0], actions, attributes, rewritten, envp);
    free(rewritten);
    return result;
}

int posix_spawnp(pid_t *pid, const char *file, const void *actions, const void *attributes, char *const argv[],
                 char *const envp[]) {
    if (file && strchr(file, '/')) return posix_spawn(pid, file, actions, attributes, argv, envp);
    static spawn_fn real;
    if (!real) real = (spawn_fn)dlsym(MUSL_RTLD_NEXT, "posix_spawnp");
    return real(pid, file, actions, attributes, argv, envp);
}
