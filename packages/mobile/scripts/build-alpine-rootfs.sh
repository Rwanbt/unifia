#!/usr/bin/env bash
# Build a pre-populated Alpine aarch64 rootfs with developer tools.
# Must be run INSIDE WSL Ubuntu (invoked via wsl.exe from Windows).
#
# Output: <mobile>/src-tauri/assets/runtime/rootfs.tgz (~80MB compressed)
#
# Idempotence: if the output tar.gz is younger than 30 days, skip rebuild.
# Force rebuild: rm <output>/rootfs.tgz then re-run.

set -euo pipefail

# chroot requires root. Re-exec as root if needed (passwordless sudo expected in WSL).
if [ "$(id -u)" != "0" ]; then
  exec sudo --preserve-env=HOME,USER,SUDO_USER bash "$0" "$@"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Translate Windows path ??? WSL mount path
# SCRIPT_DIR will be something like /mnt/d/App/OpenCode/opencode/packages/mobile/scripts
MOBILE_DIR="$SCRIPT_DIR/.."
ASSET_DIR="$(realpath "$MOBILE_DIR/src-tauri/assets/runtime")"
OUTPUT="$ASSET_DIR/rootfs.tgz"
WORKDIR="$(mktemp -d /tmp/alpine-rootfs-XXXXXX)"

mkdir -p "$ASSET_DIR"

# ????????? Idempotence check ?????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
if [ -f "$OUTPUT" ]; then
  AGE_DAYS=$(( ( $(date +%s) - $(stat -c %Y "$OUTPUT") ) / 86400 ))
  if [ "$AGE_DAYS" -lt 30 ]; then
    echo "=== rootfs.tgz is ${AGE_DAYS}d old (< 30d), skipping rebuild ==="
    echo "    Delete $OUTPUT to force a rebuild."
    exit 0
  fi
  echo "=== rootfs.tgz is ${AGE_DAYS}d old, rebuilding ==="
fi

trap 'echo "--- cleanup ---"; rm -rf "$WORKDIR"' EXIT

echo "=== Building Alpine aarch64 rootfs ==="
echo "    Workdir : $WORKDIR"
echo "    Output  : $OUTPUT"
echo ""

# ????????? 1. Install host dependencies ????????????????????????????????????????????????????????????????????????????????????????????????????????????
echo "[1/7] Installing host deps (qemu-user-static, binfmt-support)..."
if ! dpkg -l qemu-user-static &>/dev/null; then
  sudo apt-get update -qq
  sudo apt-get install -y -qq qemu-user-static binfmt-support
fi
# Register binfmt handlers (idempotent)
sudo update-binfmts --enable 2>/dev/null || true
echo "    qemu-user-static ready."

# ????????? 2. Download Alpine minirootfs ?????????????????????????????????????????????????????????????????????????????????????????????????????????
echo "[2/7] Downloading Alpine 3.21.3 aarch64 minirootfs..."
ALPINE_URL="https://dl-cdn.alpinelinux.org/alpine/v3.21/releases/aarch64/alpine-minirootfs-3.21.3-aarch64.tar.gz"
ALPINE_TAR="$WORKDIR/alpine-minirootfs.tar.gz"
# Published next to the tarball as .sha256 and matched by its .asc, which verifies
# with Alpine's release key 0482D84022F52DF1C4E7CD43293ACD0907D9495A (checked 2026-10-22).
ALPINE_SHA256="ead8a4b37867bd19e7417dd078748e2312c0aea364403d96758d63ea8ff261ea"
curl -fsSL --progress-bar "$ALPINE_URL" -o "$ALPINE_TAR"
echo "$ALPINE_SHA256  $ALPINE_TAR" | sha256sum -c - || { echo "ERROR: Alpine minirootfs checksum mismatch" >&2; exit 1; }

ROOTFS="$WORKDIR/rootfs"
mkdir -p "$ROOTFS"
tar -xzf "$ALPINE_TAR" -C "$ROOTFS"
echo "    Alpine extracted to $ROOTFS"

# Copy qemu-user-static so the chroot can run aarch64 binaries on x86_64
cp /usr/bin/qemu-aarch64-static "$ROOTFS/usr/bin/"

# ????????? 3. Configure DNS inside rootfs ??????????????????????????????????????????????????????????????????????????????????????????????????????
echo "[3/7] Seeding /etc/resolv.conf inside rootfs..."
cat > "$ROOTFS/etc/resolv.conf" <<'RESOLV'
nameserver 8.8.8.8
nameserver 8.8.4.4
nameserver 1.1.1.1
RESOLV

# ????????? 4. apk update + add packages ????????????????????????????????????????????????????????????????????????????????????????????????????????????
echo "[4/7] Updating Alpine package index..."
sudo chroot "$ROOTFS" /sbin/apk update

echo "[4/7] Installing developer packages (this takes ~10-20 min via qemu)..."
sudo chroot "$ROOTFS" /sbin/apk add --no-cache \
  nano less vim \
  git make patch \
  tmux screen \
  openssh-client rsync wget curl \
  python3 py3-pip nodejs npm \
  jq tree htop fzf fd bat \
  ca-certificates \
  file diffutils findutils gawk sed grep \
  build-base \
  rust cargo \
  strace ltrace \
  sqlite \
  openjdk17-jdk maven \
  autoconf automake libtool pkgconf \
  shellcheck shfmt clang19-extra-tools \
  openssl-dev libffi-dev zlib-dev \
  ncdu

echo "    Packages installed."

# ????????? 5. Compile libmusl_exec.so inside the Alpine chroot ???????????????????????????????????????
# This LD_PRELOAD library intercepts execve() in musl processes and
# redirects sub-forks (git-remote-https, pip subprocesses, etc.) to use
# $MUSL_LINKER (= libmusl_linker.so in nativeLibraryDir) instead of
# attempting a direct execve that SELinux would block on app_data_file.
#
# Must be compiled with Alpine's native musl-gcc so it is musl-compatible.
# A Bionic (NDK) build would be ABI-incompatible with Alpine binaries.
echo "[5/7] Compiling libmusl_exec.so inside Alpine chroot (musl-gcc)..."

cat > "$ROOTFS/tmp/libmusl_exec.c" << 'EXEC_C'
/*
 * libmusl_exec.so ??? LD_PRELOAD execve interposer for Alpine-on-Android.
 *
 * Problem: Alpine (musl-linked) binaries live in app_data_file (SELinux).
 * Android 13+ denies execute_no_trans on app_data_file for untrusted_app.
 * Direct execve("/rootfs/usr/bin/git-remote-https") ??? EACCES.
 *
 * Solution: redirect execve(musl-elf-or-script) to:
 *   execve($MUSL_LINKER, [$MUSL_LINKER, original_binary, args...], envp)
 * $MUSL_LINKER = libmusl_linker.so in nativeLibraryDir (apk_data_file,
 * exec-allowed). The musl linker mmap's the target binary (READ only,
 * app_data_file ??? allowed for same UID) and runs it directly.
 *
 * LD_LIBRARY_PATH must be set by the caller to include the rootfs lib dirs
 * so the musl linker can resolve shared library dependencies.
 *
 * Compile: gcc -shared -fPIC -O2 -nostartfiles -o libmusl_exec.so libmusl_exec.c -ldl
 */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <stddef.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define MAX_PATH 4096

typedef int (*execve_fn)(const char *, char *const [], char *const []);
static execve_fn real_execve;

__attribute__((constructor))
static void init_hook(void) {
    real_execve = (execve_fn)dlsym(RTLD_NEXT, "execve");
}

/* Returns 1 if path is a system/nativeLibraryDir path (don't intercept). */
static int is_passthrough_path(const char *p) {
    if (!p || p[0] != '/') return 1; /* relative paths: pass through */
    if (strncmp(p, "/system/",  8) == 0) return 1;
    if (strncmp(p, "/vendor/",  8) == 0) return 1;
    if (strncmp(p, "/apex/",    6) == 0) return 1;
    /* Skip paths in the same directory as MUSL_LINKER (= nativeLibraryDir):
     * those are Bionic JNI libs (bash, bun, rg???) that run fine natively. */
    const char *linker = getenv("MUSL_LINKER");
    if (linker && linker[0]) {
        const char *slash = strrchr(linker, '/');
        if (slash) {
            size_t dlen = (size_t)(slash - linker) + 1;
            if (strncmp(p, linker, dlen) == 0) return 1;
        }
    }
    return 0;
}

/* Reads ELF magic + scans for "ld-musl" in the PT_INTERP header area.
 * Returns 1 if the binary is a musl-linked ELF. */
static int is_musl_elf(const char *rpath) {
    int fd = open(rpath, O_RDONLY | O_CLOEXEC);
    if (fd < 0) return 0;
    unsigned char buf[512];
    ssize_t n = read(fd, buf, sizeof(buf) - 1);
    close(fd);
    if (n < 4 || buf[0] != 0x7f || buf[1] != 'E' || buf[2] != 'L' || buf[3] != 'F')
        return 0;
    buf[n] = 0;
    for (ssize_t i = 4; i < n - 7; i++)
        if (memcmp(buf + i, "ld-musl", 7) == 0) return 1;
    return 0;
}

/*
 * Parse a shebang line like "#!/rootfs/usr/bin/env python3" into:
 *   interp = "/rootfs/usr/bin/env"
 *   arg    = "python3"  (may be empty)
 * Returns 1 if shebang is present AND interpreter is not a passthrough path.
 */
static int read_shebang(const char *rpath,
                         char *interp, size_t isz,
                         char *arg,    size_t asz) {
    int fd = open(rpath, O_RDONLY | O_CLOEXEC);
    if (fd < 0) return 0;
    char buf[512];
    ssize_t n = read(fd, buf, sizeof(buf) - 1);
    close(fd);
    if (n < 2 || buf[0] != '#' || buf[1] != '!') return 0;
    buf[n] = '\0';
    char *nl = memchr(buf + 2, '\n', (size_t)(n - 2));
    if (nl) *nl = '\0';
    char *p = buf + 2;
    while (*p == ' ' || *p == '\t') p++;
    if (!*p) return 0;

    char *sp = strchr(p, ' ');
    if (sp) {
        size_t ilen = (size_t)(sp - p);
        if (ilen >= isz) ilen = isz - 1;
        memcpy(interp, p, ilen);
        interp[ilen] = '\0';
        char *a = sp + 1;
        while (*a == ' ' || *a == '\t') a++;
        strncpy(arg, a, asz - 1);
        arg[asz - 1] = '\0';
    } else {
        strncpy(interp, p, isz - 1);
        interp[isz - 1] = '\0';
        arg[0] = '\0';
    }
    return !is_passthrough_path(interp);
}

static int count_argv(char *const v[]) {
    int n = 0; while (v[n]) n++; return n;
}

int execve(const char *pathname, char *const argv[], char *const envp[]) {
    if (!real_execve) {
        real_execve = (execve_fn)dlsym(RTLD_NEXT, "execve");
        if (!real_execve) { errno = ENOSYS; return -1; }
    }
    if (!pathname || is_passthrough_path(pathname))
        return real_execve(pathname, argv, envp);

    const char *linker = getenv("MUSL_LINKER");
    if (!linker || !linker[0])
        return real_execve(pathname, argv, envp);

    /* Resolve symlinks so we inspect the real file type */
    char resolved[MAX_PATH];
    const char *rpath = (realpath(pathname, resolved) != NULL) ? resolved : pathname;
    if (is_passthrough_path(rpath))
        return real_execve(pathname, argv, envp);

    int orig_argc = count_argv(argv);
    char **nv = NULL;
    int nargc;

    char interp[MAX_PATH], arg1[MAX_PATH];

    if (is_musl_elf(rpath)) {
        /* Musl ELF: [linker, pathname, argv[1..]] */
        nargc = orig_argc + 1;
        nv = malloc((size_t)(nargc + 1) * sizeof(char *));
        if (!nv) { errno = ENOMEM; return -1; }
        nv[0] = (char *)linker;
        nv[1] = (char *)pathname;
        for (int i = 1; i < orig_argc; i++) nv[i + 1] = argv[i];
        nv[nargc] = NULL;

    } else if (read_shebang(rpath, interp, sizeof(interp), arg1, sizeof(arg1))) {
        /* Script: [linker, interp, [arg1,] pathname, argv[1..]] */
        int has_arg = arg1[0] != '\0';
        nargc = orig_argc + (has_arg ? 3 : 2);
        nv = malloc((size_t)(nargc + 1) * sizeof(char *));
        if (!nv) { errno = ENOMEM; return -1; }
        int k = 0;
        nv[k++] = (char *)linker;
        nv[k++] = interp;
        if (has_arg) nv[k++] = arg1;
        nv[k++] = (char *)pathname;
        for (int i = 1; i < orig_argc; i++) nv[k++] = argv[i];
        nv[nargc] = NULL;

    } else {
        /* Unknown / static binary or non-musl ELF ??? pass through */
        return real_execve(pathname, argv, envp);
    }

    int ret = real_execve(linker, nv, (char *const *)envp);
    free(nv);
    return ret;
}
EXEC_C

# Compile inside the chroot using Alpine's native musl-gcc
sudo chroot "$ROOTFS" \
  gcc -shared -fPIC -O2 -nostartfiles \
      -o /usr/lib/libmusl_exec.so \
      /tmp/libmusl_exec.c \
      -ldl

# Verify
if [ ! -f "$ROOTFS/usr/lib/libmusl_exec.so" ]; then
  echo "ERROR: libmusl_exec.so compilation failed!"
  exit 1
fi
echo "    libmusl_exec.so compiled ($(du -sh "$ROOTFS/usr/lib/libmusl_exec.so" | cut -f1))"

# jvm-host is the entry point of `java21` (ADR-097, JDK 21 through jvm-host). It links against the JDK 21
# libjvm.so, which the APK does not ship: openjdk21-jdk is installed for this step only and removed again.
# At run time the host finds the extension's libjvm.so through its RUNPATH.
echo "[5b/7] Compiling jvm-host inside Alpine chroot (JDK 21 installed for the build only)..."
sudo cp "$MOBILE_DIR/native/jvm-host/jvm-host.c" "$ROOTFS/tmp/jvm-host.c"
sudo chroot "$ROOTFS" /sbin/apk add --no-cache --virtual .jvm-host-build openjdk21-jdk
sudo chroot "$ROOTFS" /bin/sh -c '
  mkdir -p /usr/libexec/unifia &&
  gcc -std=c11 -Wall -Wextra -Werror -O2 -fPIC \
    -I/usr/lib/jvm/java-21-openjdk/include -I/usr/lib/jvm/java-21-openjdk/include/linux \
    -o /usr/libexec/unifia/jvm-host /tmp/jvm-host.c \
    /usr/lib/jvm/java-21-openjdk/lib/server/libjvm.so \
    -Wl,-rpath,/usr/lib/jvm/java-21-openjdk/lib/server
'
sudo chroot "$ROOTFS" /bin/sh -s <<'SMOKE'
set -e
mkdir -p /tmp/jvm-host-smoke
cat > /tmp/jvm-host-smoke/Smoke.java <<'JAVA'
public class Smoke {
    public static void main(String[] args) {
        System.out.println("jvm-host smoke " + System.getProperty("java.version"));
    }
}
JAVA
javac -d /tmp/jvm-host-smoke /tmp/jvm-host-smoke/Smoke.java
/usr/libexec/unifia/jvm-host -cp /tmp/jvm-host-smoke Smoke
SMOKE
sudo chroot "$ROOTFS" /bin/sh -c 'rm -rf /tmp/jvm-host.c /tmp/jvm-host-smoke'
sudo chroot "$ROOTFS" /sbin/apk del .jvm-host-build
if [ ! -f "$ROOTFS/usr/libexec/unifia/jvm-host" ] || [ -e "$ROOTFS/usr/lib/jvm/java-21-openjdk/lib/server/libjvm.so" ]; then
  echo "ERROR: jvm-host missing, or JDK 21 still present in the rootfs after the build!" >&2
  exit 1
fi
echo "    jvm-host compiled ($(du -sh "$ROOTFS/usr/libexec/unifia/jvm-host" | cut -f1)), JDK 21 removed again"

# ????????? 6. Strip build tools to reduce size ???????????????????????????????????????????????????????????????????????????????????????
echo "[6/7] Checking compilers, recording package versions, removing build leftovers..."
# gcc and musl-dev stay: cargo links through cc, and toolchain.rs repairs and wraps the
# compiler drivers on device. (An `apk del gcc musl-dev` here was always refused by apk,
# since build-base depends on both, and a `|| true` hid the refusal.)
for compiler in gcc g++ cc c++; do
  sudo chroot "$ROOTFS" /bin/sh -c "command -v $compiler" >/dev/null || { echo "ERROR: $compiler missing from rootfs" >&2; exit 1; }
done
# Alpine drops superseded package files, so versions cannot be pinned at install time;
# the exact set built is recorded instead, next to the archive.
sudo chroot "$ROOTFS" /sbin/apk info -v | sort > "$ASSET_DIR/rootfs-packages.txt"
# Remove the qemu binary and temp files
rm -f "$ROOTFS/usr/bin/qemu-aarch64-static"
rm -f "$ROOTFS/tmp/libmusl_exec.c"
rm -rf "$ROOTFS/var/cache/apk"

echo "    Rootfs size after strip: $(du -sh "$ROOTFS" | cut -f1)"

# ????????? 7. Create tar.gz ????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
echo "[7/7] Creating rootfs.tgz..."
# Archive from INSIDE rootfs so entries are relative (./usr/bin/git, etc.)
# This avoids --strip-components issues with Android's toybox tar.
TMPOUT="$WORKDIR/rootfs.tgz"
(cd "$ROOTFS" && sudo tar -czf "$TMPOUT" .)
mv "$TMPOUT" "$OUTPUT"

echo ""
echo "=== Done ==="
echo "    Output : $OUTPUT"
echo "    Size   : $(du -sh "$OUTPUT" | cut -f1)"
echo ""
echo "Next step: bun tauri android build --target aarch64"
