// SPDX-License-Identifier: MIT
//! Keeps command wrappers in step with the on-device toolchain manager (ADR-097).
//!
//! The Bun engine installs Alpine packages into the rootfs at run time
//! (`packages/unifia/src/toolchain/`), but wrapper generation lives here, in
//! `prepare_toolchain_wrappers`, and used to run only at app start. Every
//! committed manager transaction replaces `<rootfs>/../toolchains/db.json`
//! through a rename, so a change of its modification time means "the rootfs
//! changed": re-run the repair and the wrapper pass then, and nothing else.
#![cfg(unix)]

use super::toolchain::{prepare_toolchain_wrappers, repair_rootfs_hardlinks};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, SystemTime};
use std::{fs, thread};

const POLL_INTERVAL: Duration = Duration::from_secs(2);

/// Mirrors `defaultLocation` in `packages/unifia/src/toolchain/download.ts`.
pub(super) fn manager_database(rootfs_dir: &Path) -> PathBuf {
    rootfs_dir
        .parent()
        .unwrap_or(rootfs_dir)
        .join("toolchains")
        .join("db.json")
}

fn stamp(database: &Path) -> Option<SystemTime> {
    fs::metadata(database)
        .and_then(|metadata| metadata.modified())
        .ok()
}

/// One poll: regenerates the wrappers when the database changed since `last`.
/// Returns whether a regeneration ran.
pub(super) fn refresh_if_changed(
    last: &mut Option<SystemTime>,
    rootfs_dir: &Path,
    nlib_dir: &Path,
    cache_dir: &Path,
    on_refresh: &dyn Fn(),
) -> bool {
    let current = stamp(&manager_database(rootfs_dir));
    if current == *last {
        return false;
    }
    *last = current;
    repair_rootfs_hardlinks(rootfs_dir);
    match prepare_toolchain_wrappers(rootfs_dir, nlib_dir, cache_dir) {
        Ok(_) => on_refresh(),
        Err(e) => log::warn!("[Unifia] toolchain change: wrapper refresh failed: {} — new commands need an app restart", e),
    }
    true
}

/// Starts the poller. It lives as long as the process, like the embedded
/// server it serves; a stat every two seconds is its whole cost when idle.
/// `on_refresh` runs after each successful regeneration; the server uses it to
/// rewrite the shell rc files, which every agent shell command re-sources.
pub(super) fn spawn_wrapper_refresh(rootfs_dir: PathBuf, nlib_dir: PathBuf, cache_dir: PathBuf, on_refresh: Box<dyn Fn() + Send>) {
    // WHY: start_embedded_server runs again on every server restart, and the
    // poller outlives each run; one per process is enough.
    static STARTED: AtomicBool = AtomicBool::new(false);
    if STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    let mut last = stamp(&manager_database(&rootfs_dir));
    let spawned = thread::Builder::new()
        .name("toolchain-wrappers".into())
        .spawn(move || loop {
            thread::sleep(POLL_INTERVAL);
            if refresh_if_changed(&mut last, &rootfs_dir, &nlib_dir, &cache_dir, &*on_refresh) {
                log::info!("[Unifia] toolchain change: command wrappers regenerated");
            }
        });
    if let Err(e) = spawned {
        log::warn!(
            "[Unifia] could not start the toolchain wrapper refresher: {}",
            e
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn layout(name: &str) -> (PathBuf, PathBuf, PathBuf, PathBuf) {
        let base = std::env::temp_dir().join(format!(
            "unifia_toolchain_watch_{}_{}",
            name,
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&base);
        let (rootfs, nlib, cache) = (base.join("rootfs"), base.join("nlib"), base.join("cache"));
        fs::create_dir_all(rootfs.join("usr/bin")).unwrap();
        fs::create_dir_all(&nlib).unwrap();
        fs::create_dir_all(&cache).unwrap();
        for lib in ["libbash_exec.so", "libmusl_linker.so", "libgit_dispatch.so"] {
            fs::write(nlib.join(lib), b"stub").unwrap();
        }
        (base, rootfs, nlib, cache)
    }

    fn dynamic_elf() -> Vec<u8> {
        let mut elf = vec![0x7f, b'E', b'L', b'F'];
        elf.resize(2048, 0);
        elf
    }

    #[test]
    fn manager_database_sits_next_to_the_rootfs() {
        assert_eq!(
            manager_database(Path::new("/data/files/rootfs")),
            PathBuf::from("/data/files/toolchains/db.json")
        );
    }

    #[test]
    fn a_manager_commit_makes_a_new_command_reachable_without_restart() {
        let (base, rootfs, nlib, cache) = layout("commit");
        let mut last = stamp(&manager_database(&rootfs));
        assert!(
            !refresh_if_changed(&mut last, &rootfs, &nlib, &cache, &|| {}),
            "nothing changed yet"
        );

        // What a manager install leaves behind: the binary, then the database.
        fs::write(rootfs.join("usr/bin/python3"), dynamic_elf()).unwrap();
        fs::create_dir_all(manager_database(&rootfs).parent().unwrap()).unwrap();
        fs::write(
            manager_database(&rootfs),
            b"{\"version\":1,\"packages\":{}}",
        )
        .unwrap();

        assert!(refresh_if_changed(&mut last, &rootfs, &nlib, &cache, &|| {}));
        let wrapper =
            fs::read_to_string(cache.join("wrappers/python3")).expect("python3 wrapper generated");
        assert!(wrapper.contains("libmusl_linker.so"), "{wrapper}");
        assert!(
            !refresh_if_changed(&mut last, &rootfs, &nlib, &cache, &|| {}),
            "no second pass for the same commit"
        );
        let _ = fs::remove_dir_all(base);
    }
}
