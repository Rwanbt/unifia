//! On-device toolchain wrapper setup (extracted from `runtime.rs` — D-01 step 1).
//!
//! Self-contained cluster lifted verbatim from the former `runtime.rs` god file:
//! rootfs hardlink repair, the logged symlink helper, and the shebang +
//! `LD_PRELOAD` wrapper generation that lets cargo / rustc / gcc run under
//! Android's `untrusted_app` SELinux policy. It has **no outgoing dependency**
//! on the rest of `runtime` (only `std` + `log`), so it moves cleanly.
//!
//! `use super::*` re-imports the parent's `std::fs` / `std::path` aliases; the
//! three entry points are `pub(super)` so `start_embedded_server` /
//! `install_extended_env` (still in `runtime.rs`) and the `mod tests` can call
//! them through `runtime`'s `use toolchain::{…}` re-export.
//!
//! File gated to Unix (C-008): every entry point here uses `std::os::unix` or
//! `PermissionsExt::set_mode`, neither of which exists on Windows. On Windows
//! `cargo clippy --all-targets` would otherwise fail with E0433 / E0599 in the
//! host `cfg(test)` build. Tests in `runtime.rs` that call these entry points
//! carry their own `#[cfg(unix)]` so the Windows test set skips them cleanly.
#![cfg(unix)]

use super::*;

/// Recreate rootfs hardlink aliases as symlinks. Alpine ships each compiler
/// driver / binutils tool under several names hardlinked to ONE inode
/// (`gcc` ↔ `aarch64-alpine-linux-musl-gcc`, and crucially `c++` ↔ `g++` ↔
/// their prefixed forms — all the *same* C++ driver). `tar` serialises the
/// first member of a hardlink set as a real file and the rest as hardlink
/// entries; SELinux `app_data_file` blocks `link()` on-device, so typically
/// only ONE member of each set survives extraction. We pick the survivor and
/// symlink every missing member to it.
///
/// DEBT: D-13 device finding (Mi 10 Pro) — the previous per-*pair* logic
/// treated `(c++, prefixed-c++)` and `(g++, prefixed-g++)` as independent
/// sets. When tar happened to keep `g++` (or its prefixed form), the c++ pair
/// was `(absent, absent)` and could not self-heal, leaving on-device C++
/// compilation broken. Modelling the four C++ names as one equivalence group
/// fixes this: a surviving `g++` now backs `c++`. Likewise `cc` ≡ `gcc`.
pub(super) fn repair_rootfs_hardlinks(rootfs_dir: &Path) {
    let bin = rootfs_dir.join("usr/bin");

    // Each inner slice is one hardlink / functionally-equivalent driver set.
    // `cc` is the generic name for `gcc` and `c++` for `g++` (same drivers), so
    // any survivor in a compiler group can stand in for the whole group — that
    // is what closes the c++ gap above.
    const GROUPS: &[&[&str]] = &[
        &["gcc", "aarch64-alpine-linux-musl-gcc", "cc", "aarch64-alpine-linux-musl-cc"],
        &["g++", "aarch64-alpine-linux-musl-g++", "c++", "aarch64-alpine-linux-musl-c++"],
        &["cpp", "aarch64-alpine-linux-musl-cpp"],
        &["gcc-ar", "aarch64-alpine-linux-musl-gcc-ar"],
        &["gcc-nm", "aarch64-alpine-linux-musl-gcc-nm"],
        &["gcc-ranlib", "aarch64-alpine-linux-musl-gcc-ranlib"],
        &["ar", "aarch64-alpine-linux-musl-ar"],
        &["ranlib", "aarch64-alpine-linux-musl-ranlib"],
        &["strip", "aarch64-alpine-linux-musl-strip"],
        &["objcopy", "aarch64-alpine-linux-musl-objcopy"],
        &["objdump", "aarch64-alpine-linux-musl-objdump"],
        &["nm", "aarch64-alpine-linux-musl-nm"],
        &["as", "aarch64-alpine-linux-musl-as"],
        &["readelf", "aarch64-alpine-linux-musl-readelf"],
        &["addr2line", "aarch64-alpine-linux-musl-addr2line"],
        &["size", "aarch64-alpine-linux-musl-size"],
        &["strings", "aarch64-alpine-linux-musl-strings"],
        &["c++filt", "aarch64-alpine-linux-musl-c++filt"],
    ];

    for group in GROUPS {
        repair_hardlink_group(&bin, group);
    }
    // perl ships as perl5.<version> hardlinked to perl; only the versioned name survives the extraction.
    repair_versioned_alias(&bin, "perl", "perl5.");

    // D-13: a missing C/C++ compiler driver only surfaces much later as a
    // confusing "command not found" deep inside cargo/gcc. Check the critical
    // drivers right after repair and warn loudly if any are still absent.
    const CRITICAL: &[&str] = &["gcc", "g++", "cc", "c++"];
    let missing: Vec<&str> = CRITICAL
        .iter()
        .copied()
        .filter(|name| !resolves_to_file(&bin.join(name)))
        .collect();
    if !missing.is_empty() {
        log::warn!(
            "[OpenCode] repair_rootfs_hardlinks: critical toolchain binaries missing after extraction: {:?} — on-device compilation will fail",
            missing
        );
    }
}

/// Links `name` to the first `<versioned_prefix>*` file in `bin` when `name` itself is missing.
pub(super) fn repair_versioned_alias(bin: &Path, name: &str, versioned_prefix: &str) {
    if resolves_to_file(&bin.join(name)) {
        return;
    }
    let Ok(entries) = fs::read_dir(bin) else { return };
    let mut candidates: Vec<String> = entries
        .flatten()
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|candidate| candidate.starts_with(versioned_prefix) && resolves_to_file(&bin.join(candidate)))
        .collect();
    candidates.sort();
    if let Some(versioned) = candidates.first() {
        force_symlink(Path::new(versioned), &bin.join(name));
    }
}

/// True if `p` resolves (following symlinks) to an existing regular file.
/// A dangling symlink resolves to nothing → `false`, so such a member is
/// treated as missing and gets re-pointed at a live survivor.
pub(super) fn resolves_to_file(p: &Path) -> bool {
    fs::metadata(p).map(|m| m.is_file()).unwrap_or(false)
}

/// Symlink every missing member of one hardlink/equivalence group to a
/// surviving member. No-op if the whole group is absent (warns instead — the
/// caller's CRITICAL check escalates that for compiler drivers).
pub(super) fn repair_hardlink_group(bin: &Path, group: &[&str]) {
    // First member that resolves to a real file becomes the link target.
    let Some(survivor) = group.iter().copied().find(|m| resolves_to_file(&bin.join(m))) else {
        log::warn!(
            "[OpenCode] repair_rootfs_hardlinks: no member of group {:?} present after extraction",
            group
        );
        return;
    };
    for member in group.iter().copied() {
        if member == survivor {
            continue;
        }
        let member_path = bin.join(member);
        // Already a working file (real, or a symlink that resolves)? leave it.
        if resolves_to_file(&member_path) {
            continue;
        }
        // Absent or a dangling symlink → (re)create it pointing at the
        // survivor. Relative target: both live in usr/bin.
        force_symlink(Path::new(survivor), &member_path);
    }
}

/// Recreate `link` as a symlink pointing at `src`, logging any failure rather
/// than swallowing it. Used for the 50+ binary/applet symlinks rebuilt on
/// every launch (their nativeLibraryDir target changes with each APK install).
/// A silent failure here leaves a dangling command with no diagnostic.
/// DEBT: D-12 — replaces the `let _ = fs::remove_file(); let _ = symlink();` pairs.
pub(super) fn force_symlink(src: &Path, link: &Path) {
    if let Err(e) = fs::remove_file(link) {
        if e.kind() != std::io::ErrorKind::NotFound {
            log::warn!(
                "[OpenCode] force_symlink: failed to remove stale {}: {}",
                link.display(),
                e
            );
        }
    }
    if let Err(e) = std::os::unix::fs::symlink(src, link) {
        log::warn!(
            "[OpenCode] force_symlink: failed to link {} -> {}: {}",
            link.display(),
            src.display(),
            e
        );
    }
}

/// Compiler drivers and binutils: wrapped in place by `prepare_toolchain_wrappers`
/// and exposed through `script_tools`, never as ELF entry points.
const SCRIPT_TOOLS: &[&str] = &[
    "gcc", "g++", "cc", "ar", "as", "ld", "ld.bfd", "ranlib", "strip",
    "objcopy", "objdump", "nm", "cpp", "c++",
];

/// Every command in `<rootfs>/usr/bin` that can get an entry-point wrapper:
/// sorted, without busybox applets (busybox picks the applet from argv[0],
/// which the linker hop would lose; the shell provides those), without the
/// compiler drivers handled as scripts, and without wrapping backups.
pub(super) fn installed_commands(rootfs_dir: &Path) -> Vec<String> {
    let Ok(entries) = fs::read_dir(rootfs_dir.join("usr/bin")) else {
        return Vec::new();
    };
    let mut names: Vec<String> = entries
        .flatten()
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|name| {
            !name.ends_with(".elf64")
                && !name.starts_with("aarch64-alpine-linux-musl-")
                && !SCRIPT_TOOLS.contains(&name.as_str())
        })
        .filter(|name| {
            let target = fs::read_link(rootfs_dir.join("usr/bin").join(name)).ok();
            target.and_then(|t| t.file_name().map(|f| f == "busybox")) != Some(true)
        })
        .collect();
    names.sort();
    names
}

// `java`, `javac`, `jar`, `mvn` and `gradle` run the JDK 17 the APK ships, under PRoot. The JDK 21 the toolchain
// manager installs cannot start through the java launcher on the phone (PRoot refuses its JIT probe), so it runs
// through `jvm-host`, which starts the same JVM in-process (`JVM21_COMMAND`, ADR-097 §4).
const JDK_TOOLS: [&str; 3] = ["java", "javac", "jar"];
/// Entry point for JDK 21: `java21 [JVM options] -cp <path> <main class> [args]`, `java21 -jar <file>`, `java21 -version`.
const JVM21_COMMAND: &str = "java21";
const JVM21_HOST_GUEST: &str = "/usr/libexec/unifia/jvm-host";
const JDK21_LIBJVM: &str = "usr/lib/jvm/java-21-openjdk/lib/server/libjvm.so";
const JDK21_MISSING: &str = "JDK 21 is not installed; install openjdk21-jdk with the toolchain manager";
const PROOT_BUILD_TOOLS: [&str; 2] = ["mvn", "gradle"];
const GO_TOOLS: [&str; 2] = ["go", "gofmt"];
const JDK17_DIR: &str = "usr/lib/jvm/java-17-openjdk";
const GO_ROOT_DIR: &str = "usr/lib/go";
const JDK_MISSING: &str = "JDK 17 is not installed; install openjdk17-jdk with the toolchain manager";
const GO_MISSING: &str = "Go is not installed; install go with the toolchain manager";
const KOTLIN_TOOLS: [&str; 2] = ["kotlinc", "kotlin"];
const KOTLIN_VERSION: &str = "2.1.0";
const KOTLIN_URL: &str = "https://github.com/JetBrains/kotlin/releases/download/v2.1.0/kotlin-compiler-2.1.0.zip";
// The `.sha256` JetBrains publishes beside the release, checked against the downloaded zip (2026-10-26).
const KOTLIN_SHA256: &str = "b6698d5728ad8f9edcdd01617d638073191d8a03139cc538a391b4e3759ad297";
// The server's SSL_CERT_FILE names a host path PRoot does not bind; curl fails on it with error 77.
const ROOTFS_CA_BUNDLE: &str = "/etc/ssl/certs/ca-certificates.crt";
const KOTLIN_COMPILER_MAIN: &str = "org.jetbrains.kotlin.cli.jvm.K2JVMCompiler";
const KOTLIN_RUNNER_MAIN: &str = "org.jetbrains.kotlin.runner.Main";

/// Host paths a PRoot wrapper needs, grouped so the script builder takes one argument.
pub(super) struct ProotPaths<'a> {
    pub bash: &'a Path,
    pub proot: &'a Path,
    pub loader: &'a Path,
    pub rootfs: &'a Path,
    pub home: &'a Path,
    pub tmp: &'a Path,
}

/// Shell script that runs one JDK 17 tool under PRoot. The same binary launched through `libmusl_linker.so`
/// dies with SIGSYS (busybox) or with `cannot load -version` (java). PRoot binds only `/dev`, `/proc`, `/sys`
/// and the agent home, so the working directory is passed through only when it is inside the home; anywhere
/// else the tool starts at `/`.
///
/// The script uses `[ -e ]`, not `[ -x ]`: `access(X_OK)` is refused by the app's seccomp filter, which kills
/// the shell with SIGSYS. It takes the working directory from `$PWD`, not `pwd -P`: the app shell reports the
/// home through the `/data/data` symlink, and PRoot binds the canonical `/data/user/0` path.
pub(super) fn jdk_wrapper_script(paths: &ProotPaths<'_>, tool: &str) -> String {
    let inner = format!("\"/{JDK17_DIR}/bin/{tool}\" \"$@\"", JDK17_DIR = JDK17_DIR, tool = tool);
    jdk_launcher(paths, tool, &inner)
}

/// Maven and Gradle start their JVM from PATH. Run whole under PRoot, that JVM is the JDK 17 install, selected
/// through `JAVA_HOME` and PATH, and it never goes through the kernel's shebang exec, which the filter refuses.
pub(super) fn build_tool_wrapper_script(paths: &ProotPaths<'_>, tool: &str) -> String {
    let inner = format!(
        "/bin/sh -c 'export PATH=/{JDK17_DIR}/bin:/usr/sbin:/usr/bin:/sbin:/bin JAVA_HOME=/{JDK17_DIR}; exec {tool} \"$@\"' {tool} \"$@\"",
        JDK17_DIR = JDK17_DIR,
        tool = tool,
    );
    // Gradle is an on-demand extension, so the rootfs may lack it: the launcher names the missing tool.
    let required = format!("usr/bin/{tool}", tool = tool);
    let missing = format!("not installed; install {tool} with the toolchain manager", tool = tool);
    proot_launcher(paths, tool, &inner, &required, &missing)
}

/// Go's toolchain is statically linked, so the linker route cannot run it, and the kernel refuses a shebang exec
/// from app data. Under PRoot it runs as an ordinary ELF, as the JDK does. The PATH is set to the Go install so
/// that `exec` never finds this wrapper again.
pub(super) fn go_wrapper_script(paths: &ProotPaths<'_>, tool: &str) -> String {
    let inner = format!(
        "/bin/sh -c 'export PATH=/{GO_ROOT_DIR}/bin:/usr/sbin:/usr/bin:/sbin:/bin GOROOT=/{GO_ROOT_DIR}; exec {tool} \"$@\"' {tool} \"$@\"",
        GO_ROOT_DIR = GO_ROOT_DIR,
        tool = tool,
    );
    let required = format!("{GO_ROOT_DIR}/bin/{tool}", GO_ROOT_DIR = GO_ROOT_DIR, tool = tool);
    proot_launcher(paths, tool, &inner, &required, GO_MISSING)
}

/// Kotlin is not packaged by Alpine, so the first `kotlinc` or `kotlin` downloads the official compiler, checks
/// it against the pinned SHA-256 and unpacks it in the home. The JetBrains launchers need bash, which the rootfs
/// lacks under PRoot, so the wrapper starts the compiler's and the runner's main classes on the JDK 17 directly.
pub(super) fn kotlin_wrapper_script(paths: &ProotPaths<'_>, tool: &str) -> String {
    let main = if tool == "kotlinc" {
        format!("-cp \"$k/lib/kotlin-compiler.jar\" {KOTLIN_COMPILER_MAIN} -kotlin-home \"$k\"")
    } else {
        format!("-Dkotlin.home=\"$k\" -cp \"$k/lib/kotlin-runner.jar\" {KOTLIN_RUNNER_MAIN}")
    };
    let inner = format!(
        "/bin/sh -c 'export PATH=/{JDK17_DIR}/bin:/usr/bin:/bin JAVA_HOME=/{JDK17_DIR}; \
         k=\"$HOME/.cache/toolchains/kotlinc-{KOTLIN_VERSION}\"; \
         if [ ! -f \"$k/lib/kotlin-compiler.jar\" ]; then \
         echo \"{tool}: downloading Kotlin {KOTLIN_VERSION} (first use)\" >&2; \
         t=\"$k.part\"; rm -rf \"$t\"; mkdir -p \"$t\" \
         && curl -fsSL --cacert {ROOTFS_CA_BUNDLE} -o \"$t/k.zip\" {KOTLIN_URL} \
         && echo \"{KOTLIN_SHA256}  $t/k.zip\" | busybox sha256sum -c - >/dev/null \
         && busybox unzip -q \"$t/k.zip\" -d \"$t\" && mv \"$t/kotlinc\" \"$k\"; rc=$?; rm -rf \"$t\"; \
         if [ $rc != 0 ]; then echo \"{tool}: Kotlin download failed\" >&2; exit 1; fi; \
         fi; \
         exec java {main} \"$@\"' {tool} \"$@\"",
        JDK17_DIR = JDK17_DIR,
        KOTLIN_VERSION = KOTLIN_VERSION,
        KOTLIN_URL = KOTLIN_URL,
        KOTLIN_SHA256 = KOTLIN_SHA256,
        ROOTFS_CA_BUNDLE = ROOTFS_CA_BUNDLE,
        tool = tool,
        main = main,
    );
    jdk_launcher(paths, tool, &inner)
}

/// Every JVM wrapper needs the JDK 17 install, so the launcher checks for its `java` before it starts PRoot.
fn jdk_launcher(paths: &ProotPaths<'_>, tool: &str, inner: &str) -> String {
    proot_launcher(paths, tool, inner, &format!("{JDK17_DIR}/bin/java", JDK17_DIR = JDK17_DIR), JDK_MISSING)
}

/// The launcher the wrapper kinds share: check that `required` (a rootfs-relative path) is installed, pass the
/// working directory through when it is inside the home, and exec PRoot on the rootfs with `inner` as the command.
fn proot_launcher(paths: &ProotPaths<'_>, tool: &str, inner: &str, required: &str, missing: &str) -> String {
    // -L as well as -e: Alpine links usr/bin/* to absolute targets that exist only inside the rootfs, so the
    // host resolves them as dangling and -e alone reports an installed tool as missing.
    format!(
        "#!{bash}\n\
         if [ ! -e \"{rootfs}/{required}\" ] && [ ! -L \"{rootfs}/{required}\" ]; then\n\
         echo \"{tool}: {missing}\" >&2\n\
         exit 127\n\
         fi\n\
         export PROOT_TMP_DIR=\"{tmp}\"\n\
         export PROOT_LOADER=\"{loader}\"\n\
         cwd=\"$PWD\"\n\
         case \"$cwd\" in\n\
         /data/data/*) cwd=\"/data/user/0/${{cwd#/data/data/}}\" ;;\n\
         esac\n\
         case \"$cwd\" in\n\
         \"{home}\"|\"{home}\"/*) ;;\n\
         *) cwd=/ ;;\n\
         esac\n\
         exec \"{proot}\" -0 -r \"{rootfs}\" -b /dev -b /proc -b /sys -b \"{home}\"{home_alias} -w \"$cwd\" {inner}\n",
        bash = paths.bash.display(),
        rootfs = paths.rootfs.display(),
        required = required,
        missing = missing,
        tool = tool,
        tmp = paths.tmp.display(),
        loader = paths.loader.display(),
        home = paths.home.display(),
        home_alias = home_alias_binding(paths.home),
        proot = paths.proot.display(),
        inner = inner,
    )
}

// The app shell reports the home through the `/data/data` symlink, and a path a tool builds from `$0` keeps that
// spelling (the kotlinc launcher derives its classpath that way): binding the home under it too keeps such
// paths visible inside PRoot.
const DATA_USER_PREFIX: &str = "/data/user/0/";
const DATA_DATA_PREFIX: &str = "/data/data/";

fn home_alias_binding(home: &Path) -> String {
    let home = home.display().to_string();
    match home.strip_prefix(DATA_USER_PREFIX) {
        Some(rest) => format!(" -b \"{home}:{DATA_DATA_PREFIX}{rest}\""),
        None => String::new(),
    }
}

/// Writes a wrapper script and marks it executable, as the other wrapper writers in this module do.
fn write_executable(path: &Path, content: &str) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::write(path, content)?;
    let mut perm = fs::metadata(path)?.permissions();
    perm.set_mode(0o755);
    fs::set_permissions(path, perm)
}

/// The JDK 21 entry point. The guard checks the JDK 21 install (its `libjvm.so`), because the host links against it.
pub(super) fn jvm21_wrapper_script(paths: &ProotPaths<'_>) -> String {
    let inner = format!("\"{host}\" \"$@\"", host = JVM21_HOST_GUEST);
    proot_launcher(paths, JVM21_COMMAND, &inner, JDK21_LIBJVM, JDK21_MISSING)
}

/// The PRoot wrapper for a tool that cannot run through the linker, or `None` for a tool that takes the linker route.
pub(super) fn proot_wrapper_script(paths: &ProotPaths<'_>, tool: &str) -> Option<String> {
    if JDK_TOOLS.contains(&tool) {
        Some(jdk_wrapper_script(paths, tool))
    } else if tool == JVM21_COMMAND {
        Some(jvm21_wrapper_script(paths))
    } else if PROOT_BUILD_TOOLS.contains(&tool) {
        Some(build_tool_wrapper_script(paths, tool))
    } else if GO_TOOLS.contains(&tool) {
        Some(go_wrapper_script(paths, tool))
    } else if KOTLIN_TOOLS.contains(&tool) {
        Some(kotlin_wrapper_script(paths, tool))
    } else {
        None
    }
}

/// Set up cargo / rustc / gcc / binutils so they run on-device despite the
/// Android 13+ `untrusted_app` SELinux policy denying `execute_no_trans` on
/// `app_data_file`.
///
/// Why this is needed:
/// musl libc resolves intra-libc calls (`execve`, `posix_spawn`) with hidden
/// visibility, so an LD_PRELOAD interposer cannot intercept the syscalls that
/// `cargo` and `rustc` use to spawn `rustc` / `cc` / `collect2` / `ld` /
/// `cc1` / `as`. Each of those targets sits in `/rootfs/...` (app_data_file)
/// and the kernel returns EACCES (reported as ENOENT by the SELinux hook).
///
/// Two-step solution:
/// 1. **In-rootfs wrap.** For every musl-ELF subprocess that is spawned by
///    absolute path (cc1, collect2, lto1, the binutils, the rustc-specific
///    LLVM tools), rename the binary to `<name>.elf64` and replace the
///    original with a shebang script `#!<nlib>/libbash_exec.so` that
///    re-execs through `<nlib>/libmusl_linker.so <name>.elf64`. The kernel's
///    binfmt_script handler exec'd into `libbash_exec.so` (which lives in
///    `nativeLibraryDir`, an apk_data_file label that *is* execute-allowed),
///    bypassing the EACCES on the script's app_data_file label.
/// 2. **Entry-point wrappers.** Generate `<cache>/wrappers/{cargo,rustc,…}`
///    shebang scripts for the toolchain binaries Cargo / the user invoke
///    directly. PATH-first prepends this dir; `RUSTC` env var hard-pins the
///    rustc wrapper for cargo.
///
/// Idempotent: skips files already wrapped (those whose `.elf64` backup
/// exists). Liblto_plugin.so is restored if it was wrapped (it must remain a
/// loadable shared library, not a script).
pub(super) fn prepare_toolchain_wrappers(
    rootfs_dir: &Path,
    nlib_dir: &Path,
    cache_dir: &Path,
) -> std::io::Result<PathBuf> {
    use std::os::unix::fs::PermissionsExt;

    let bash_exec = nlib_dir.join("libbash_exec.so");
    let musl_linker = nlib_dir.join("libmusl_linker.so");
    let git_dispatch = nlib_dir.join("libgit_dispatch.so");
    // PRoot for the JDK, Maven, Gradle and Go entry points. The agent home is the parent of the cache dir (`home/.cache`).
    let proot_exec = nlib_dir.join("libproot_exec.so");
    let proot_loader = nlib_dir.join("libproot-loader.so");
    // Native entry point the wrapper names link to; an APK without it keeps the script wrappers.
    let tool_dispatch = Some(nlib_dir.join(TOOL_DISPATCH)).filter(|path| path.exists());
    let home = cache_dir.parent().unwrap_or(cache_dir).to_path_buf();
    let proot_tmp = cache_dir.join("proot-tmp");

    if !bash_exec.exists() || !musl_linker.exists() || !git_dispatch.exists() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "Android native exec helpers are incomplete in nativeLibraryDir",
        ));
    }

    // LD_LIBRARY_PATH injected into every wrapper script. The binfmt_script →
    // libbash_exec.so → libmusl_linker.so chain re-execs the .elf64 from
    // scratch, so the script's own env (not git's env at exec time) is what
    // the dynamic linker sees. Without this, ELF helpers under
    // usr/libexec/git-core/ (git-remote-http, git-http-fetch, …) can't
    // resolve libcurl.so.4 / libpcre2-8.so.0 / libz.so.1 / libssl.so.3 /
    // libcrypto.so.3 even though they exist in <rootfs>/usr/lib/ — verified
    // on-device: with LD_LIBRARY_PATH unset the linker reports
    // "Error loading shared library libcurl.so.4"; with it set the helper
    // starts cleanly and waits for the git remote-helper protocol on stdin.
    // Includes usr/libexec/git-core so helpers there find their dependencies
    // when the loader is invoked with no LD_LIBRARY_PATH from the parent.
    // Also includes llvm19/lib (clang-extra-tools) and the JDK lib dir so
    // java finds libjli.so + libz.so.1 — same set as the entry-point
    // wrappers further down for consistency.
    let musl_libs = prepare_musl_library_dir(rootfs_dir, cache_dir)?;
    let enosys_shim = Some(nlib_dir.join(ENOSYS_SHIM)).filter(|path| path.exists());
    let preload = enosys_shim
        .as_ref()
        .map(|shim| format!("--preload \"{}\" ", shim.display()))
        .unwrap_or_default();
    let ld_path = format!(
        "{m}:{r}/usr/libexec/git-core:{r}/usr/lib/llvm19/lib:{r}/{jdk}/lib",
        m = musl_libs.display(),
        r = rootfs_dir.display(),
        jdk = JDK17_DIR
    );

    // Wrap one ELF binary as a shebang-script that re-execs through linker.
    // Idempotent: if `<file>.elf64` already exists we assume `file` is
    // already a wrapper script and skip. Symlinks are skipped — wrapping a
    // symlink would break the resolver chain.
    let wrap_one = |file: &Path| -> std::io::Result<()> {
        // Skip our own `.elf64` backup files — without this, a second pass
        // through the libexec directory would treat `collect2.elf64` as a
        // fresh ELF and wrap it AGAIN, producing `collect2.elf64.elf64` and
        // a wrapper script at `collect2.elf64` that the linker then can't
        // load ("Not a valid dynamic program").
        if file
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.ends_with(".elf64"))
            .unwrap_or(false)
        {
            return Ok(());
        }
        // Convention: append `.elf64` to the FULL filename so `liblto_plugin.so`
        // becomes `liblto_plugin.so.elf64` (rather than `liblto_plugin.elf64`,
        // which `with_extension` would produce).
        let backup = PathBuf::from(format!("{}.elf64", file.display()));
        let meta_res = fs::symlink_metadata(file);

        // If both `<file>` (wrapper script) and `<file>.elf64` (real ELF) exist
        // already, this is a previous wrap. Don't redo the rename — but DO
        // refresh the wrapper script: nativeLibraryDir contains the per-install
        // APK hash, so a wrapper from a prior install points to a now-dead
        // `libbash_exec.so` path and `cc: cannot execute: required file not
        // found`. Always re-write so the shebang tracks the current install.
        // Also: the script MUST export LD_LIBRARY_PATH so the dynamic linker
        // (libmusl_linker.so) can resolve libcurl.so.4 / libpcre2-8.so.0 /
        // libz.so.1 for git-core helpers, and libstdc++.so.6 for cargo/rustc
        // binutils spawned by absolute path.
        if backup.exists() {
            if let Ok(meta) = &meta_res {
                if meta.file_type().is_symlink() {
                    return Ok(());
                }
            }
            let script = format!(
                "#!{bash}\nexport LD_LIBRARY_PATH=\"{ld}:${{LD_LIBRARY_PATH}}\"\nexec \"{linker}\" {preload}\"{backup}\" \"$@\"\n",
                bash = bash_exec.display(),
                ld = ld_path,
                linker = musl_linker.display(),
                backup = backup.display(),
            );
            if let Err(e) = fs::write(file, script) {
                log::warn!(
                    "[OpenCode] prepare_toolchain_wrappers: failed to refresh wrapper {}: {} — stale shebang may point at a dead libbash_exec.so (cc: cannot execute)",
                    file.display(),
                    e
                );
            }
            if let Ok(mut perm) = fs::metadata(file).map(|m| m.permissions()) {
                perm.set_mode(0o755);
                if let Err(e) = fs::set_permissions(file, perm) {
                    log::warn!(
                        "[OpenCode] prepare_toolchain_wrappers: failed to chmod refreshed wrapper {}: {}",
                        file.display(),
                        e
                    );
                }
            }
            return Ok(());
        }

        let meta = meta_res?;
        if meta.file_type().is_symlink() {
            return Ok(());
        }
        if !meta.is_file() || meta.len() < 1024 {
            return Ok(());
        }
        let mut magic = [0u8; 4];
        {
            use std::io::Read;
            let mut f = fs::File::open(file)?;
            let _ = f.read(&mut magic);
        }
        if magic != [0x7f, b'E', b'L', b'F'] {
            return Ok(());
        }
        fs::rename(file, &backup)?;
        let script = format!(
            "#!{bash}\nexport LD_LIBRARY_PATH=\"{ld}:${{LD_LIBRARY_PATH}}\"\nexec \"{linker}\" {preload}\"{backup}\" \"$@\"\n",
            bash = bash_exec.display(),
            ld = ld_path,
            linker = musl_linker.display(),
            backup = backup.display(),
        );
        fs::write(file, script)?;
        let mut perm = fs::metadata(file)?.permissions();
        perm.set_mode(0o755);
        fs::set_permissions(file, perm)?;
        Ok(())
    };

    // 1. Wrap GCC libexec internals (cc1, cc1plus, collect2, lto1, …) — these
    //    are spawned by absolute path by cc/g++ and bypass any PATH wrappers.
    let libexec_root = rootfs_dir.join("usr/libexec/gcc");
    if let Ok(versions) = fs::read_dir(&libexec_root) {
        for triplet in versions.flatten() {
            if let Ok(versions2) = fs::read_dir(triplet.path()) {
                for ver in versions2.flatten() {
                    if let Ok(entries) = fs::read_dir(ver.path()) {
                        for entry in entries.flatten() {
                            let p = entry.path();
                            // Skip .so plugins (must remain dlopen-able).
                            if p.extension().and_then(|e| e.to_str()) == Some("so") {
                                continue;
                            }
                            if let Err(e) = wrap_one(&p) {
                                log::warn!(
                                    "[OpenCode] prepare_toolchain_wrappers: failed to wrap gcc libexec {}: {} — linking may fail later with a misleading error",
                                    p.display(),
                                    e
                                );
                            }
                            // gcc starts these with posix_spawn, which the kernel refuses for a script in app data;
                            // the dispatcher symlink runs <name>.elf64 through the linker instead.
                            if let Err(e) = link_wrapped_to_dispatcher(&p, &tool_dispatch) {
                                log::warn!(
                                    "[OpenCode] prepare_toolchain_wrappers: failed to link {} to the dispatcher: {}",
                                    p.display(),
                                    e
                                );
                            }
                        }
                    }
                }
            }
        }
    }

    // Restore liblto_plugin.so if it was previously wrapped (must be a real .so).
    if let Ok(entries) = fs::read_dir(&libexec_root) {
        for triplet in entries.flatten() {
            if let Ok(versions) = fs::read_dir(triplet.path()) {
                for ver in versions.flatten() {
                    let lto_dir = ver.path();
                    let lto = lto_dir.join("liblto_plugin.so");
                    let lto_backup = lto_dir.join("liblto_plugin.so.elf64");
                    if lto.exists() && lto_backup.exists() {
                        // The script wrapper is at lto, the real .so is at backup
                        let is_script = fs::read(&lto)
                            .ok()
                            .map(|b| b.starts_with(b"#!"))
                            .unwrap_or(false);
                        if is_script {
                            if let Err(e) = fs::remove_file(&lto) {
                                log::warn!(
                                    "[OpenCode] prepare_toolchain_wrappers: failed to remove wrapped lto script {}: {}",
                                    lto.display(),
                                    e
                                );
                            }
                            if let Err(e) = fs::rename(&lto_backup, &lto) {
                                log::warn!(
                                    "[OpenCode] prepare_toolchain_wrappers: failed to restore liblto_plugin.so at {}: {} — LTO builds will break",
                                    lto.display(),
                                    e
                                );
                            }
                        }
                    }
                }
            }
        }
    }

    // 1b. Wrap git-core internals (git-remote-https, git-remote-http,
    //     git-http-backend, git-http-fetch, …) — spawned by `git` via an
    //     absolute path resolved from its own exec-path (`usr/libexec/git-core`
    //     on Alpine), exactly like cc1/collect2 above. Without this, `git
    //     clone`/`push`/`pull` over https:// fail with SIGSYS ("Bad system
    //     call") or EACCES ("Permission denied") because the kernel's direct
    //     execve of an unwrapped app_data_file ELF is blocked/unsafe under the
    //     untrusted_app SELinux policy — the musl hidden-visibility issue
    //     means an LD_PRELOAD execve hook never sees this spawn either.
    let git_core_root = rootfs_dir.join("usr/libexec/git-core");

    // Git first re-execs itself through the exec-path before invoking an HTTPS
    // helper. Scripts under app_data_file work from run-as but SELinux denies
    // them in the real untrusted_app domain. Point the dispatcher at an
    // APK-extracted PIE executable, which routes usr/bin/git back through
    // libmusl_linker.so.
    let git_dispatcher = git_core_root.join("git");
    let git_binary = rootfs_dir.join("usr/bin/git");
    if git_binary.exists() {
        let already_native = fs::read_link(&git_dispatcher)
            .map(|target| target == git_dispatch)
            .unwrap_or(false);
        if !already_native {
            if fs::symlink_metadata(&git_dispatcher).is_ok() {
                fs::remove_file(&git_dispatcher)?;
            }
            std::os::unix::fs::symlink(&git_dispatch, &git_dispatcher)?;
        }
    }

    let wrap_git_core = |file: &Path| -> std::io::Result<()> {
        if file
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.ends_with(".elf64"))
            .unwrap_or(false)
        {
            return Ok(());
        }

        let backup = PathBuf::from(format!("{}.elf64", file.display()));
        let metadata = fs::symlink_metadata(file)?;
        if metadata.file_type().is_symlink() {
            // nativeLibraryDir is per-install (its path embeds a hash that
            // changes on every APK reinstall/update). A symlink already
            // pointing at libgit_dispatch.so from a PRIOR install is stale —
            // that hash directory is gone once the old install is replaced,
            // making the symlink dangling (exec fails with ENOENT, surfaced
            // to the user as "git-upload-pack: inaccessible or not found").
            // Comparing only the target's basename ("== git") never catches
            // this because a stale libgit_dispatch.so target also has that
            // basename — must compare the full resolved path against the
            // CURRENT run's git_dispatch to detect staleness.
            let current_target = fs::read_link(file).ok();
            let is_dispatch_style = current_target
                .as_ref()
                .and_then(|target| target.file_name())
                .map(|name| name == "git" || name == "libgit_dispatch.so")
                .unwrap_or(false);
            let already_current = current_target.as_deref() == Some(git_dispatch.as_path());
            if is_dispatch_style && !already_current {
                fs::remove_file(file)?;
                std::os::unix::fs::symlink(&git_dispatch, file)?;
            }
            return Ok(());
        }

        if backup.exists() {
            fs::remove_file(file)?;
            std::os::unix::fs::symlink(&git_dispatch, file)?;
            return Ok(());
        }
        if !metadata.is_file() || metadata.len() < 1024 {
            return Ok(());
        }

        let mut magic = [0u8; 4];
        {
            use std::io::Read;
            let mut input = fs::File::open(file)?;
            let _ = input.read(&mut magic);
        }
        if magic != [0x7f, b'E', b'L', b'F'] {
            return Ok(());
        }

        fs::rename(file, &backup)?;
        std::os::unix::fs::symlink(&git_dispatch, file)?;
        Ok(())
    };
    if let Ok(entries) = fs::read_dir(&git_core_root) {
        for entry in entries.flatten() {
            let p = entry.path();
            // Skip .so plugins and symlinks (e.g. git-remote-https -> git-remote-http);
            // wrap_one already skips symlinks itself, but .so has no extension
            // gate here since git-core ships none — kept for parity with the
            // gcc libexec loop in case a future Alpine build adds one.
            if p.extension().and_then(|e| e.to_str()) == Some("so") {
                continue;
            }
            if let Err(e) = wrap_git_core(&p) {
                log::warn!(
                    "[OpenCode] prepare_toolchain_wrappers: failed to wrap git-core {}: {} — git clone/push/pull over https will fail",
                    p.display(),
                    e
                );
            }
        }
    }

    // 2. Wrap binutils + target-prefixed binutils + rustc-specific LLVM tools.
    let binutils_targets = [
        "as", "ld.bfd", "ld.gold", "ar", "ranlib", "strip",
        "objcopy", "objdump", "nm", "readelf", "addr2line", "size", "strings", "c++filt",
    ];
    for name in &binutils_targets {
        let p = rootfs_dir.join("usr/bin").join(name);
        if p.exists() {
            if let Err(e) = wrap_one(&p) {
                log::warn!(
                    "[OpenCode] prepare_toolchain_wrappers: failed to wrap binutils {}: {}",
                    p.display(),
                    e
                );
            }
        }
    }
    if let Ok(entries) = fs::read_dir(rootfs_dir.join("usr/bin")) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            if let Some(s) = name.to_str() {
                if s.starts_with("aarch64-alpine-linux-musl-")
                    && !s.ends_with(".elf64")
                {
                    let p = entry.path();
                    if let Err(e) = wrap_one(&p) {
                        log::warn!(
                            "[OpenCode] prepare_toolchain_wrappers: failed to wrap prefixed binutils {}: {}",
                            p.display(),
                            e
                        );
                    }
                }
            }
        }
    }
    // clang re-executes its own binary for -cc1 with posix_spawn, which the kernel refuses for an app-data ELF.
    // Wrapped in place and linked to the dispatcher, that re-exec comes back through the linker.
    let clang_binary = rootfs_dir.join(CLANG_BINARY);
    if clang_binary.exists() || PathBuf::from(format!("{}.elf64", clang_binary.display())).exists() {
        if let Err(e) = wrap_one(&clang_binary).and_then(|()| link_wrapped_to_dispatcher(&clang_binary, &tool_dispatch)) {
            log::warn!("[OpenCode] prepare_toolchain_wrappers: failed to wrap {}: {}", clang_binary.display(), e);
        }
    }
    let rustlib_bin = rootfs_dir.join("usr/lib/rustlib/aarch64-alpine-linux-musl/bin");
    if let Ok(entries) = fs::read_dir(&rustlib_bin) {
        for entry in entries.flatten() {
            let p = entry.path();
            if let Err(e) = wrap_one(&p) {
                log::warn!(
                    "[OpenCode] prepare_toolchain_wrappers: failed to wrap rustlib tool {}: {}",
                    p.display(),
                    e
                );
            }
        }
    }

    // 3. Recreate `ld` symlink to ld.bfd if missing — Alpine binutils ship it
    //    as a symlink and `collect2` looks for it by bare name. Some prior
    //    wrap passes lost it.
    let ld = rootfs_dir.join("usr/bin/ld");
    let ld_bfd = rootfs_dir.join("usr/bin/ld.bfd");
    if ld_bfd.exists() && !ld.exists() {
        // DEBT: D-12 — collect2 resolves `ld` by bare name; a silent failure
        // here breaks linking with a misleading error far downstream.
        if let Err(e) = std::os::unix::fs::symlink("ld.bfd", &ld) {
            log::warn!("[OpenCode] failed to recreate ld -> ld.bfd symlink: {}", e);
        }
    }

    // 4. Generate /cache/wrappers/ entry-point scripts.
    let wrappers = cache_dir.join("wrappers");
    fs::create_dir_all(&wrappers)?;
    fs::create_dir_all(&proot_tmp)?;

    // ELF entry points (cargo, rustc, python3, …) — invoke linker directly.
    // Mix of musl ELFs and shell scripts; the is_script branch below handles both.
    let elf_tools = [
        // Existing core toolchain
        "rustc", "cargo", "python", "python3", "node", "npm", "node-gyp",
        "pip", "pip3", "rustup",
        // Git (push/pull/fetch over https; internal git-core helpers wrapped
        // separately above since they're spawned by absolute path, not PATH)
        "git",
        // Phase 1 extension: debug + profiling
        "gdb", "lldb", "strace", "ltrace",
        // PHP stack
        "php", "php83", "composer",
        // SQL clients
        "sqlite3", "psql", "mysql",
        // Modern build systems
        "cmake", "ctest", "ninja", "samu", "meson", "pkgconf",
        // Go
        "go", "gofmt",
        // Ruby
        "ruby", "gem", "irb",
        // Java / JVM tooling
        "java", "javac", "jar", "gradle", "mvn", "kotlinc", "kotlin",
        // TypeScript (the Alpine typescript package)
        "tsc", "tsserver",
        // Linters / formatters
        "shellcheck", "shfmt", "clang-tidy", "clang-format",
    ];
    // Resolve symlinks while keeping resolution sandboxed inside the rootfs.
    // fs::canonicalize escapes the sandbox: an absolute symlink like
    // `/usr/lib/go/bin/go` (typical for go/gradle/mvn/psql in Alpine) resolves
    // against the device root (which has no /usr/lib/go) and yields ENOENT.
    // We strip the leading slash and re-anchor at rootfs_dir instead.
    fn resolve_in_rootfs(path: &Path, rootfs: &Path) -> Option<PathBuf> {
        let mut current = path.to_path_buf();
        for _ in 0..16 {
            match fs::symlink_metadata(&current) {
                Ok(md) if md.file_type().is_symlink() => {
                    let target = fs::read_link(&current).ok()?;
                    current = if target.is_absolute() {
                        rootfs.join(target.strip_prefix("/").ok()?)
                    } else {
                        current.parent()?.join(target)
                    };
                }
                Ok(_) => return Some(current),
                Err(_) => return None,
            }
        }
        None
    }

    // Extract the interpreter basename from a `#!...` shebang line.
    // Returns None if the file has no shebang or the line is malformed.
    fn parse_shebang_interp(path: &Path) -> Option<String> {
        let buf = fs::read(path).ok()?;
        if !buf.starts_with(b"#!") {
            return None;
        }
        let line_end = buf[2..].iter().position(|&b| b == b'\n').unwrap_or(buf.len() - 2);
        let line = std::str::from_utf8(&buf[2..2 + line_end]).ok()?.trim();
        let mut words = line.split_whitespace();
        let interp_path = words.next()?;
        let name = Path::new(interp_path).file_name().and_then(|s| s.to_str())?;
        // `#!/usr/bin/env node` (npm-cli.js): the interpreter is the program env would have looked up.
        if name == "env" {
            return words.find(|word| !word.starts_with('-')).map(|word| word.to_string());
        }
        Some(name.to_string())
    }

    // LD_LIBRARY_PATH injected into every wrapper so dynamically-linked tools
    // (php, gdb, sqlite3, java, ruby, clang-tidy, …) find their .so deps in
    // the rootfs. Without this, exec succeeds but the loader bails on the
    // first DT_NEEDED. Includes llvm19/lib (clang-extra-tools) and the JDK
    // lib dir so `java` finds libjli.so + libz.so.1.
    let ld_path = format!(
        "{m}:{r}/usr/lib/llvm19/lib:{r}/{jdk}/lib",
        m = musl_libs.display(),
        r = rootfs_dir.display(),
        jdk = JDK17_DIR
    );

    // ADR-097: the toolchain manager installs packages at run time, so the fixed
    // list above is only a floor; every other command in usr/bin gets a wrapper too.
    let mut commands: Vec<String> = elf_tools.iter().map(|t| t.to_string()).collect();
    // Not in usr/bin: the host is a launcher of its own, so it needs an entry even though no package provides it.
    commands.push(JVM21_COMMAND.to_string());
    for extra in installed_commands(rootfs_dir) {
        if !commands.contains(&extra) {
            commands.push(extra);
        }
    }
    let proot = ProotPaths {
        bash: &bash_exec,
        proot: &proot_exec,
        loader: &proot_loader,
        rootfs: rootfs_dir,
        home: &home,
        tmp: &proot_tmp,
    };
    let mut written: std::collections::HashSet<String> = std::collections::HashSet::new();
    for t in &commands {
        let t = t.as_str();
        // clang drivers start the dispatcher-linked binary itself, so its -cc1 re-exec lands there too.
        if CLANG_DRIVERS.contains(&t) && tool_dispatch.is_some() && fs::symlink_metadata(&clang_binary).is_ok() {
            let script = format!(
                "#!{bash}\nexport LD_LIBRARY_PATH=\"{ld}:${{LD_LIBRARY_PATH}}\"\nexec \"{clang}\"{extra} \"$@\"\n",
                bash = bash_exec.display(),
                ld = ld_path,
                clang = clang_binary.display(),
                extra = compiler_arguments(t, rootfs_dir),
            );
            install_wrapper(&wrappers, &tool_dispatch, t, &script)?;
            written.insert(t.to_string());
            continue;
        }
        if let Some(script) = proot_wrapper_script(&proot, t) {
            install_wrapper(&wrappers, &tool_dispatch, t, &script)?;
            written.insert(t.to_string());
            continue;
        }
        let src = rootfs_dir.join("usr/bin").join(t);
        let real = match resolve_in_rootfs(&src, rootfs_dir) {
            Some(r) => r,
            None => continue,
        };
        let head = fs::read(&real).ok();
        let is_script = head
            .as_ref()
            .map(|b| b.starts_with(b"#!"))
            .unwrap_or(false);
        // Statically-linked ELFs (e.g. shfmt) have no PT_INTERP, so the
        // "ld-musl" string never appears in their headers. They cannot be run
        // via libmusl_linker.so (which expects a dynamic ELF to mmap+relocate)
        // and SELinux blocks direct execve from app_data_file. Skip them — a
        // user-facing wrapper that just errors is worse than no wrapper.
        // Static ELFs (shfmt; go and gofmt take the PRoot route above) have no PT_INTERP and
        // can't run via libmusl_linker.so (which expects a dynamic ELF). Parse
        // the ELF program headers and look for a PT_INTERP entry — this is
        // more robust than scanning for the "ld-musl" string, which has false
        // negatives (shfmt embeds the literal in a data section even though
        // it's static) and required a full-file scan to avoid false positives
        // on Rust binaries (cargo/rustc keep the interp past the first 2 KB).
        fn is_static_elf64(buf: &[u8]) -> bool {
            if buf.len() < 64 || &buf[..4] != b"\x7fELF" || buf[4] != 2 {
                return false;
            }
            let to_u64 = |o: usize| u64::from_le_bytes(buf[o..o + 8].try_into().unwrap()) as usize;
            let to_u16 = |o: usize| u16::from_le_bytes(buf[o..o + 2].try_into().unwrap()) as usize;
            let phoff = to_u64(0x20);
            let phentsize = to_u16(0x36);
            let phnum = to_u16(0x38);
            if phoff == 0 || phentsize == 0 || phnum == 0 {
                return false;
            }
            let table_end = phoff.saturating_add(phnum.saturating_mul(phentsize));
            if table_end > buf.len() {
                return false;
            }
            for i in 0..phnum {
                let off = phoff + i * phentsize;
                let p_type = u32::from_le_bytes(buf[off..off + 4].try_into().unwrap());
                if p_type == 3 {
                    return false; // PT_INTERP found → dynamic
                }
            }
            true
        }
        let is_static_elf = head.as_ref().map(|b| is_static_elf64(b)).unwrap_or(false);
        if is_static_elf {
            log::info!(
                "[wrap] skip {} — static ELF (cannot run via libmusl_linker)",
                t
            );
            continue;
        }
        let script = if is_script {
            // Map the script's shebang interpreter to one of our generated
            // wrappers (or libbash_exec.so for sh scripts). Three issues we
            // dodge by re-routing instead of letting the kernel re-exec the
            // shebang directly:
            //   1. /bin/sh on Android = Bionic /system/bin/sh which honors
            //      LD_LIBRARY_PATH and CANNOT_LINK against musl libc when our
            //      LD_LIBRARY_PATH is exported. Sending sh scripts through
            //      libbash_exec.so (bash-as-shared-lib in nativeLibraryDir)
            //      bypasses Bionic entirely.
            //   2. /usr/bin/env doesn't exist on Android, so `#!/usr/bin/env
            //      python3` would fail at the kernel binfmt_script step.
            //   3. /usr/bin/python3 etc. point at the device root, not the
            //      rootfs. Routing through wrappers/python3 hits the rootfs
            //      ELF with the proper LD_LIBRARY_PATH already set in that
            //      wrapper.
            // Also: do NOT export LD_LIBRARY_PATH at the script level. Any
            // sub-binary the script spawns is itself wrapped (cargo, java,
            // php, …); each wrapper sets its own. Exporting here propagates
            // the path into Bionic /bin/sh sub-shells and breaks them.
            let shebang_interp = parse_shebang_interp(&real);
            let interp_path: Option<String> = shebang_interp.as_deref().and_then(|name| {
                match name {
                    "sh" | "bash" => Some(bash_exec.display().to_string()),
                    "env" => None,
                    other => {
                        let w = wrappers.join(other);
                        if rootfs_dir.join("usr/bin").join(other).exists() {
                            Some(w.display().to_string())
                        } else {
                            None
                        }
                    }
                }
            });
            match interp_path {
                Some(interp) => format!(
                    "#!{bash}\nexec \"{interp}\" \"{real}\" \"$@\"\n",
                    bash = bash_exec.display(),
                    interp = interp,
                    real = real.display(),
                ),
                None => format!(
                    "#!{bash}\nexec \"{real}\" \"$@\"\n",
                    bash = bash_exec.display(),
                    real = real.display(),
                ),
            }
        } else {
            format!(
                "#!{bash}\nexport LD_LIBRARY_PATH=\"{ld}:${{LD_LIBRARY_PATH}}\"\nexec \"{linker}\" {preload}\"{real}\"{extra} \"$@\"\n",
                bash = bash_exec.display(),
                ld = ld_path,
                linker = musl_linker.display(),
                real = real.display(),
                extra = compiler_arguments(t, rootfs_dir),
            )
        };
        install_wrapper(&wrappers, &tool_dispatch, t, &script)?;
        written.insert(t.to_string());
    }

    // Programs built on the phone live in app data, which Android refuses to execute directly ("Permission
    // denied" on ./a.out). unifia-run loads one through the musl linker; cargo run/test use it as their runner.
    let runner = format!(
        "#!{bash}\nexport LD_LIBRARY_PATH=\"{ld}:${{LD_LIBRARY_PATH}}\"\nexec \"{linker}\" {preload}\"$@\"\n",
        bash = bash_exec.display(),
        ld = ld_path,
        linker = musl_linker.display(),
    );
    install_wrapper(&wrappers, &tool_dispatch, PROGRAM_RUNNER, &runner)?;
    written.insert(PROGRAM_RUNNER.to_string());

    // Script entry points (cc, gcc, g++, binutils …) — already wrapped in
    // rootfs by the wrap_one pass. The in-rootfs script is handed to
    // libbash_exec.so explicitly: the kernel refuses to exec a script from app data.
    for t in SCRIPT_TOOLS {
        let src = rootfs_dir.join("usr/bin").join(t);
        if !src.exists() {
            continue;
        }
        let script = format!(
            "#!{bash}\nexec \"{bash}\" \"{src}\"{extra} \"$@\"\n",
            bash = bash_exec.display(),
            src = src.display(),
            extra = compiler_arguments(t, rootfs_dir),
        );
        install_wrapper(&wrappers, &tool_dispatch, t, &script)?;
        written.insert(t.to_string());
    }

    prune_stale_wrappers(&wrappers, &written);
    Ok(wrappers)
}

/// Freestanding SIGSYS -> -ENOSYS shim preloaded into rootfs programs (see jni/seccomp_enosys.c).
pub(super) const ENOSYS_SHIM: &str = "libseccomp_enosys.so";
/// Library directory exported to rootfs programs, under the agent cache dir (tool_dispatch.c relies on it).
pub(super) const MUSL_LIBRARY_DIR: &str = "musl-lib";
/// Development symlinks in the rootfs whose names Android's own libraries use. With the rootfs lib dirs on
/// LD_LIBRARY_PATH, a Bionic program a musl tool starts (toybox `echo` from make, the git dispatcher) loaded
/// musl's `libc.so` and died with "CANNOT LINK EXECUTABLE". musl programs need only the versioned sonames.
const BIONIC_LIBRARY_NAMES: &[&str] = &[
    "libc.so", "libm.so", "libdl.so", "libz.so", "libcrypto.so", "libssl.so", "liblog.so", "libc++.so",
];

/// Rebuilds `<cache>/musl-lib`: one symlink per library of the rootfs `usr/lib` and `lib`, without the names
/// Bionic resolves through LD_LIBRARY_PATH. `usr/lib` wins over `lib` for a name in both, as it did in the path.
pub(super) fn prepare_musl_library_dir(rootfs_dir: &Path, cache_dir: &Path) -> std::io::Result<PathBuf> {
    let dir = cache_dir.join(MUSL_LIBRARY_DIR);
    if dir.exists() {
        fs::remove_dir_all(&dir)?;
    }
    fs::create_dir_all(&dir)?;
    // perl finds libperl.so through an absolute RUNPATH into its CORE dir, which resolves against the device root.
    let sources = [rootfs_dir.join("usr/lib"), rootfs_dir.join("lib"), rootfs_dir.join("usr/lib/perl5/core_perl/CORE")];
    for source in sources {
        let Ok(entries) = fs::read_dir(&source) else { continue };
        for entry in entries.flatten() {
            let Ok(name) = entry.file_name().into_string() else { continue };
            if !name.contains(".so") || BIONIC_LIBRARY_NAMES.contains(&name.as_str()) {
                continue;
            }
            let link = dir.join(&name);
            if fs::symlink_metadata(&link).is_ok() {
                continue;
            }
            std::os::unix::fs::symlink(entry.path(), &link)?;
        }
    }
    Ok(dir)
}

/// Wrapper that runs a program built on the phone through the musl linker (see the runner in
/// `prepare_toolchain_wrappers`).
pub(super) const PROGRAM_RUNNER: &str = "unifia-run";
const C_COMPILER_DRIVERS: &[&str] = &["gcc", "g++", "cc", "c++", "cpp"];
const CLANG_DRIVERS: &[&str] = &["clang", "clang++", "clang-19", "clang++-19", "clang-cpp"];
/// The one clang binary every clang driver name resolves to in Alpine's llvm19.
const CLANG_BINARY: &str = "usr/lib/llvm19/bin/clang-19";

/// Arguments a compiler driver needs on the phone, with a leading space, or "" for any other tool.
/// The drivers resolve /usr/include and /usr/lib against the device root, so they get the rootfs as sysroot.
/// clang locates itself through /proc/self/exe, which is the musl linker here: -no-canonical-prefixes makes it
/// use argv[0] (the dispatcher-linked clang-19) for its install dir and its -cc1 re-exec. All clang names start
/// that one binary, so the C++ names select the C++ driver mode explicitly.
pub(super) fn compiler_arguments(tool: &str, rootfs_dir: &Path) -> String {
    if C_COMPILER_DRIVERS.contains(&tool) {
        format!(" --sysroot=\"{}\"", rootfs_dir.display())
    } else if CLANG_DRIVERS.contains(&tool) {
        let mode = if tool.starts_with("clang++") { " --driver-mode=g++" } else if tool == "clang-cpp" { " --driver-mode=cpp" } else { "" };
        format!(" --sysroot=\"{}\" -no-canonical-prefixes{mode}", rootfs_dir.display())
    } else {
        String::new()
    }
}

/// Replaces a binary wrapped in place (`<name>` script + `<name>.elf64`) by a symlink to the dispatcher, which
/// loads `<name>.elf64` itself. No-op without the dispatcher or for a file that was not wrapped.
pub(super) fn link_wrapped_to_dispatcher(file: &Path, dispatch: &Option<PathBuf>) -> std::io::Result<()> {
    let Some(dispatch) = dispatch else { return Ok(()) };
    if !PathBuf::from(format!("{}.elf64", file.display())).exists() {
        return Ok(());
    }
    if fs::read_link(file).ok().as_deref() == Some(dispatch.as_path()) {
        return Ok(());
    }
    if fs::symlink_metadata(file).is_ok() {
        fs::remove_file(file)?;
    }
    std::os::unix::fs::symlink(dispatch, file)
}

/// Native executable each `wrappers/<tool>` links to (see jni/tool_dispatch.c).
pub(super) const TOOL_DISPATCH: &str = "libtool_dispatch.so";
/// Where the wrapper scripts live once the wrapper names are dispatcher symlinks.
pub(super) const WRAPPER_SCRIPTS_DIR: &str = ".scripts";

/// Installs one wrapper. With the dispatcher, the script goes to `wrappers/.scripts/<tool>` and `wrappers/<tool>`
/// links to the dispatcher: the kernel refuses to exec a script from app data, so `sh -c`, make, npm or cargo
/// could not start a script wrapper, while a symlink to an APK-extracted executable is allowed to run.
pub(super) fn install_wrapper(wrappers: &Path, dispatch: &Option<PathBuf>, tool: &str, script: &str) -> std::io::Result<()> {
    let link = wrappers.join(tool);
    let Some(dispatch) = dispatch else {
        if fs::symlink_metadata(&link).map(|meta| meta.file_type().is_symlink()).unwrap_or(false) {
            fs::remove_file(&link)?;
        }
        return write_executable(&link, script);
    };
    let scripts = wrappers.join(WRAPPER_SCRIPTS_DIR);
    fs::create_dir_all(&scripts)?;
    write_executable(&scripts.join(tool), script)?;
    if fs::read_link(&link).ok().as_deref() != Some(dispatch.as_path()) {
        if fs::symlink_metadata(&link).is_ok() {
            fs::remove_file(&link)?;
        }
        std::os::unix::fs::symlink(dispatch, &link)?;
    }
    Ok(())
}

/// Removes every wrapper this pass did not write, in the wrappers dir and its scripts dir. A refreshed rootfs can
/// drop a package (cmake, php, lua…) and every APK install moves nativeLibraryDir, so a wrapper left from an
/// earlier pass points at a tool or a `libbash_exec.so` that no longer exists and fails with a misleading error.
pub(super) fn prune_stale_wrappers(wrappers: &Path, written: &std::collections::HashSet<String>) {
    for dir in [wrappers.to_path_buf(), wrappers.join(WRAPPER_SCRIPTS_DIR)] {
        let Ok(entries) = fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let Ok(name) = entry.file_name().into_string() else { continue };
            if written.contains(&name) || name == WRAPPER_SCRIPTS_DIR {
                continue;
            }
            if let Err(e) = fs::remove_file(entry.path()) {
                log::warn!("[OpenCode] prune_stale_wrappers: failed to remove {}: {}", entry.path().display(), e);
            }
        }
    }
}
