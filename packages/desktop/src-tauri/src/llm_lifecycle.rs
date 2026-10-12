/* SPDX-License-Identifier: MIT */
use std::fs::{self, OpenOptions};
use std::io;
use std::path::PathBuf;

pub const LLM_PORT: u16 = 14097;

pub fn llm_base_dir() -> PathBuf {
    std::env::temp_dir().join(format!("opencode-llm-{}", LLM_PORT))
}

pub fn llm_ref_dir() -> PathBuf {
    llm_base_dir().join("refs")
}

/// Where `reclaim_port` writes the transient lease it takes before killing.
pub fn llm_lease_dir() -> PathBuf {
    llm_base_dir().join("leases")
}

pub fn llm_owner_file() -> PathBuf {
    llm_base_dir().join("owner.pid")
}

pub fn ensure_llm_private_dirs() -> io::Result<()> {
    ensure_private_dir(&llm_base_dir())?;
    ensure_private_dir(&llm_ref_dir())?;
    ensure_private_dir(&llm_lease_dir())
}

fn ensure_private_dir(path: &std::path::Path) -> io::Result<()> {
    #[cfg(unix)]
    let create_result = {
        use std::os::unix::fs::DirBuilderExt;
        let mut builder = fs::DirBuilder::new();
        builder.mode(0o700).create(path)
    };
    #[cfg(not(unix))]
    let create_result = fs::create_dir(path);

    match create_result {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(error),
    }

    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            format!("unsafe local LLM runtime directory: {}", path.display()),
        ));
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
        let secured = fs::symlink_metadata(path)?;
        if secured.file_type().is_symlink()
            || !secured.is_dir()
            || secured.permissions().mode() & 0o077 != 0
        {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                format!(
                    "local LLM runtime directory is not private: {}",
                    path.display()
                ),
            ));
        }
    }

    Ok(())
}

pub fn write_llm_ref(pid: u32) -> io::Result<()> {
    ensure_llm_private_dirs()?;
    let dir = llm_ref_dir();
    let since = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let mut options = OpenOptions::new();
    options.create(true).write(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    use std::io::Write;
    options
        .open(dir.join(format!("{}.ref", pid)))?
        .write_all(format!(r#"{{"pid":{},"since":{}}}"#, pid, since).as_bytes())
}

pub fn remove_llm_ref(pid: u32) {
    let _ = std::fs::remove_file(llm_ref_dir().join(format!("{}.ref", pid)));
}

pub fn write_llm_owner(owner_pid: u32, child_pid: u32) -> io::Result<()> {
    ensure_llm_private_dirs()?;
    let path = llm_owner_file();
    let temporary = path.with_extension("pid.tmp");
    let mut options = OpenOptions::new();
    options.create(true).write(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    use std::io::Write;
    options
        .open(&temporary)?
        .write_all(format!("{}:{}", owner_pid, child_pid).as_bytes())?;
    fs::rename(temporary, path)
}

pub fn remove_llm_owner_and_ref() {
    let pid = std::process::id();
    remove_llm_ref(pid);
    let _ = std::fs::remove_file(llm_owner_file());
}

#[cfg(test)]
mod tests {
    use super::ensure_private_dir;
    use std::fs;
    use std::path::PathBuf;

    fn unique_temp_path(label: &str) -> PathBuf {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock should be after the Unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "unifia-llm-{label}-{}-{timestamp}",
            std::process::id()
        ))
    }

    #[test]
    fn private_directory_repairs_permissions() {
        let path = unique_temp_path("permissions");
        ensure_private_dir(&path).expect("private directory should be created");

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o755))
                .expect("test directory permissions should be changed");
            ensure_private_dir(&path).expect("directory should be made private");
            let mode = fs::symlink_metadata(&path)
                .expect("directory metadata should be readable")
                .permissions()
                .mode();
            assert_eq!(mode & 0o077, 0);
        }

        fs::remove_dir_all(path).expect("test directory should be removed");
    }

    #[test]
    fn private_directory_rejects_regular_files() {
        let parent = unique_temp_path("file");
        fs::create_dir(&parent).expect("test parent should be created");
        let path = parent.join("runtime");
        fs::write(&path, "occupied").expect("test file should be created");

        let error =
            ensure_private_dir(&path).expect_err("a file must not be accepted as a directory");
        assert_eq!(error.kind(), std::io::ErrorKind::PermissionDenied);
        fs::remove_dir_all(parent).expect("test parent should be removed");
    }
}
