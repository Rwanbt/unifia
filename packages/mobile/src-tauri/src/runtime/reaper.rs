// SPDX-License-Identifier: MIT
//! Stops an embedded server left behind by a previous app process, and only that.
//!
//! When Android kills the app process, the Bun server it spawned can survive,
//! and `SERVER_PROCESS` (in memory) is gone with the app. The next start would
//! then run a second server. So every spawn records the child's identity, and
//! the next start signals the recorded PID only when the live process still has
//! that identity: same boot, same start time in clock ticks, same UID. A PID
//! the kernel has since handed to another process fails the start-time check,
//! so nothing outside Unifia is ever signalled.
#![cfg(unix)]

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(super) struct ProcessIdentity {
    pub pid: i32,
    pub start_ticks: u64,
    pub boot_id: String,
    pub uid: u32,
    /// The server is spawned as its own process-group leader, so its tool
    /// subprocesses can be stopped with it.
    pub group_leader: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum ReapOutcome {
    NoRecord,
    Gone,
    NotOurs,
    Signalled,
}

/// Reads a process identity from a `/proc`-shaped tree (the real `/proc` in production).
pub(super) fn read_identity(proc_root: &Path, pid: i32) -> Option<ProcessIdentity> {
    let stat = fs::read_to_string(proc_root.join(pid.to_string()).join("stat")).ok()?;
    // The command name is parenthesised and may hold spaces or ')': fields resume after the last ')'.
    let fields: Vec<&str> = stat[stat.rfind(')')? + 1..].split_whitespace().collect();
    // After the name: [0]=state [2]=pgrp ... [19]=starttime (fields 3, 5 and 22 of proc(5)).
    let pgrp: i32 = fields.get(2)?.parse().ok()?;
    let start_ticks: u64 = fields.get(19)?.parse().ok()?;
    let status = fs::read_to_string(proc_root.join(pid.to_string()).join("status")).ok()?;
    let uid = status
        .lines()
        .find_map(|line| line.strip_prefix("Uid:"))?
        .split_whitespace()
        .next()?
        .parse()
        .ok()?;
    let boot_id = fs::read_to_string(proc_root.join("sys/kernel/random/boot_id")).ok()?;
    Some(ProcessIdentity {
        pid,
        start_ticks,
        boot_id: boot_id.trim().to_string(),
        uid,
        group_leader: pgrp == pid,
    })
}

pub(super) fn record(record_path: &Path, identity: &ProcessIdentity) -> std::io::Result<()> {
    let temporary = record_path.with_extension("tmp");
    fs::write(&temporary, serde_json::to_vec(identity)?)?;
    fs::rename(temporary, record_path)
}

pub(super) fn forget(record_path: &Path) {
    if let Err(e) = fs::remove_file(record_path) {
        if e.kind() != std::io::ErrorKind::NotFound {
            log::warn!(
                "[Unifia] reaper: could not remove {}: {}",
                record_path.display(),
                e
            );
        }
    }
}

/// Signals the recorded server (and its process group when it leads one) if,
/// and only if, it is still the process that was recorded and runs as `own_uid`.
/// The record is consumed either way.
pub(super) fn reap_recorded(
    record_path: &Path,
    proc_root: &Path,
    own_uid: u32,
    signal: &mut dyn FnMut(i32),
) -> ReapOutcome {
    let Ok(bytes) = fs::read(record_path) else {
        return ReapOutcome::NoRecord;
    };
    forget(record_path);
    let Ok(recorded) = serde_json::from_slice::<ProcessIdentity>(&bytes) else {
        log::warn!("[Unifia] reaper: unreadable record ignored");
        return ReapOutcome::NotOurs;
    };
    let Some(live) = read_identity(proc_root, recorded.pid) else {
        return ReapOutcome::Gone;
    };
    if live != recorded || live.uid != own_uid {
        log::info!(
            "[Unifia] reaper: pid {} is not the recorded server any more, left alone",
            recorded.pid
        );
        return ReapOutcome::NotOurs;
    }
    signal(if live.group_leader {
        -live.pid
    } else {
        live.pid
    });
    ReapOutcome::Signalled
}

/// Production signal: SIGKILL to a pid, or to a whole group when negative.
pub(super) fn kill_signal(target: i32) {
    // SAFETY: kill(2) takes plain integers and touches no memory of ours.
    if unsafe { libc::kill(target, libc::SIGKILL) } != 0 {
        log::warn!(
            "[Unifia] reaper: kill({}) failed: {}",
            target,
            std::io::Error::last_os_error()
        );
    }
}

pub(super) fn own_uid() -> u32 {
    // SAFETY: getuid(2) has no failure mode and no arguments.
    unsafe { libc::getuid() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn fake_proc(name: &str) -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("unifia_reaper_{}_{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("sys/kernel/random")).unwrap();
        fs::write(root.join("sys/kernel/random/boot_id"), "boot-a\n").unwrap();
        root
    }

    fn fake_process(root: &Path, pid: i32, start_ticks: u64, uid: u32) {
        let dir = root.join(pid.to_string());
        fs::create_dir_all(&dir).unwrap();
        // A command name with a space and a ')' exercises the parser.
        // pid (comm) state ppid pgrp session tty tpgid flags minflt cminflt majflt cmajflt
        // utime stime cutime cstime priority nice threads itrealvalue starttime ...
        let stat = format!(
            "{pid} (bun (srv) x) S 1 {pid} {pid} 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 {start_ticks} 0 0"
        );
        fs::write(dir.join("stat"), stat).unwrap();
        fs::write(
            dir.join("status"),
            format!("Name:\tbun\nUid:\t{uid}\t{uid}\t{uid}\t{uid}\n"),
        )
        .unwrap();
    }

    fn reap(root: &Path, recorded: &ProcessIdentity, uid: u32) -> (ReapOutcome, Vec<i32>) {
        let record_path = root.join("server.json");
        record(&record_path, recorded).unwrap();
        let mut signalled = Vec::new();
        let outcome = reap_recorded(&record_path, root, uid, &mut |target| {
            signalled.push(target)
        });
        assert!(!record_path.exists(), "the record is consumed");
        (outcome, signalled)
    }

    #[test]
    fn the_recorded_server_and_its_group_are_signalled() {
        let root = fake_proc("ours");
        fake_process(&root, 4242, 9001, 10123);
        let identity = read_identity(&root, 4242).unwrap();
        assert!(identity.group_leader);
        assert_eq!(
            reap(&root, &identity, 10123),
            (ReapOutcome::Signalled, vec![-4242])
        );
    }

    #[test]
    fn a_reused_pid_is_never_signalled() {
        let root = fake_proc("reused");
        fake_process(&root, 4242, 9001, 10123);
        let recorded = read_identity(&root, 4242).unwrap();
        fake_process(&root, 4242, 9555, 10123); // same pid, started later: another process
        assert_eq!(
            reap(&root, &recorded, 10123),
            (ReapOutcome::NotOurs, vec![])
        );
    }

    #[test]
    fn another_uid_or_another_boot_is_never_signalled() {
        let root = fake_proc("uid");
        fake_process(&root, 4242, 9001, 10999);
        let recorded = read_identity(&root, 4242).unwrap();
        assert_eq!(
            reap(&root, &recorded, 10123),
            (ReapOutcome::NotOurs, vec![])
        );
        let other_boot = ProcessIdentity {
            boot_id: "boot-b".into(),
            ..recorded
        };
        assert_eq!(
            reap(&root, &other_boot, 10999),
            (ReapOutcome::NotOurs, vec![])
        );
    }

    #[test]
    fn a_vanished_process_or_no_record_does_nothing() {
        let root = fake_proc("gone");
        let ghost = ProcessIdentity {
            pid: 77,
            start_ticks: 1,
            boot_id: "boot-a".into(),
            uid: 1,
            group_leader: false,
        };
        assert_eq!(reap(&root, &ghost, 1), (ReapOutcome::Gone, vec![]));
        let mut never = |_: i32| panic!("no signal without a record");
        assert_eq!(
            reap_recorded(&root.join("absent.json"), &root, 1, &mut never),
            ReapOutcome::NoRecord
        );
    }

    /// Against the real kernel: a real child is recorded, identified and killed.
    #[cfg(target_os = "linux")]
    #[test]
    fn a_real_orphan_child_is_killed_through_its_identity() {
        use std::os::unix::process::CommandExt;
        let mut child = std::process::Command::new("sleep")
            .arg("30")
            .process_group(0)
            .spawn()
            .unwrap();
        let pid = child.id() as i32;
        let proc_root = Path::new("/proc");
        let identity = read_identity(proc_root, pid).expect("identity of a live child");
        assert!(identity.group_leader);
        let record_path =
            std::env::temp_dir().join(format!("unifia_reaper_real_{}.json", std::process::id()));
        record(&record_path, &identity).unwrap();
        let outcome = reap_recorded(&record_path, proc_root, own_uid(), &mut kill_signal);
        assert_eq!(outcome, ReapOutcome::Signalled);
        let status = child.wait().unwrap();
        assert!(
            !status.success(),
            "sleep was killed, not finished: {status:?}"
        );
    }
}
