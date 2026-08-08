//! Glue between the app and `unifia-supervisor`.
//!
//! Owns the lease directory and the leases taken during this run, so `lib.rs`
//! calls three plain functions instead of shelling out to `taskkill /IM`.

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use unifia_supervisor::{Lease, Supervisor, Verdict};

/// Long enough for the sidecar to flush and close its listeners, short enough
/// that quitting the app never feels stuck.
const SHUTDOWN_GRACE: Duration = Duration::from_secs(5);

/// Leases live beside the app's own data, keyed by the bundle identifier, so
/// each channel — dev, beta, stable, Preview — reclaims only its own children.
fn lease_dir() -> Option<PathBuf> {
    let app_id = if cfg!(debug_assertions) {
        crate::identity_generated::TAURI_DESKTOP_DEV_APP_ID
    } else {
        crate::identity_generated::TAURI_DESKTOP_PROD_APP_ID
    };
    Some(dirs::data_local_dir()?.join(app_id).join("leases"))
}

#[derive(Default)]
pub struct ChildProcesses {
    held: Mutex<Vec<Lease>>,
}

impl ChildProcesses {
    /// Terminates the children of a previous run that crashed or was killed.
    ///
    /// Replaces `killall unifia-cli` / `taskkill /F /IM llama-server.exe`, which
    /// ended every process with that image name on the machine.
    ///
    /// `llama-server` is not a name we own: it is llama.cpp's, so the victim was
    /// any copy the user runs themselves or through another tool. `unifia-cli` is
    /// ours, but every Unifia channel shares it, so launching the stable build
    /// killed the sidecar of a running Preview or Beta.
    ///
    /// Recovery now acts only on processes whose recorded executable path and
    /// start time still match a lease we wrote.
    pub fn recover_orphans(&self) {
        let Some(dir) = lease_dir() else {
            tracing::warn!("no data directory: skipping orphan recovery");
            return;
        };
        let mut supervisor = Supervisor::new(dir);
        match supervisor.recover_orphans() {
            Ok(report) => {
                if !report.terminated.is_empty() || !report.refused.is_empty() {
                    tracing::info!(
                        terminated = ?report.terminated,
                        already_gone = ?report.already_gone,
                        refused = ?report.refused,
                        "reclaimed orphaned child processes"
                    );
                }
            }
            Err(error) => tracing::warn!(%error, "orphan recovery failed"),
        }
    }

    /// Records a freshly spawned child. A PID we fail to adopt is one we will
    /// refuse to kill later, so the failure is logged rather than swallowed.
    pub fn adopt(&self, pid: u32) {
        let Some(dir) = lease_dir() else { return };
        match Supervisor::new(dir).adopt(pid) {
            Ok(lease) => {
                tracing::info!(pid, nonce = %lease.nonce, "took a lease on child process");
                self.held.lock().expect("lease list poisoned").push(lease);
            }
            Err(error) => tracing::warn!(pid, %error, "could not take a lease on child process"),
        }
    }

    /// Stops every child this run started, asking first and forcing only what
    /// is still provably ours.
    pub fn stop_all(&self) {
        let Some(dir) = lease_dir() else { return };
        let leases: Vec<Lease> = std::mem::take(&mut *self.held.lock().expect("lease list poisoned"));
        let mut supervisor = Supervisor::new(dir);
        for lease in leases {
            match supervisor.stop(&lease, SHUTDOWN_GRACE) {
                Verdict::Owned => tracing::info!(pid = lease.pid, "stopped child process"),
                Verdict::Gone => tracing::debug!(pid = lease.pid, "child process had already exited"),
                Verdict::Impostor { running_exe, .. } => tracing::warn!(
                    pid = lease.pid,
                    running = %running_exe.display(),
                    "left pid alone: it no longer runs the image we spawned"
                ),
            }
        }
    }
}
