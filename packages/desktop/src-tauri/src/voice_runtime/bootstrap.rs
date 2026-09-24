use sha2::{Digest, Sha256};
use std::io::Cursor;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};
use tokio::process::Command;

const UV_VERSION: &str = "0.12.18";
const PYTHON_VERSION: &str = "3.12";

pub(super) fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(qualification_data_dir) = std::env::var_os("UNIFIA_VOICE_QUALIFICATION_DATA_DIR") {
        return Ok(PathBuf::from(qualification_data_dir));
    }
    app.path().app_data_dir().map_err(|error| error.to_string())
}

pub(super) async fn prepare_runtime(app: &AppHandle) -> Result<PathBuf, String> {
    let speech_dir = app_data_dir(app)?.join("speech");
    let project = speech_dir.join("voice-host");
    tokio::fs::create_dir_all(&speech_dir)
        .await
        .map_err(|error| error.to_string())?;
    emit_progress(app, "runtime", "Preparing the managed speech runtime");
    let source = packaged_project(app)?;
    emit_progress(app, "runtime", "Installing the bundled speech worker");
    copy_runtime_project(&source, &project).await?;
    let uv = ensure_uv(&speech_dir, app).await?;
    emit_progress(app, "python", "Installing managed Python 3.12");
    run_uv(&uv, ["python", "install", PYTHON_VERSION], app, &project).await?;
    emit_progress(
        app,
        "dependencies",
        "Installing the locked CPU speech packages",
    );
    run_uv(&uv, ["sync", "--locked", "--project"], app, &project).await?;
    emit_progress(app, "runtime", "Managed speech runtime is ready");
    Ok(project)
}

fn packaged_project(app: &AppHandle) -> Result<PathBuf, String> {
    #[cfg(debug_assertions)]
    {
        let development = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../voice-host");
        if development.join("uv.lock").exists() {
            return Ok(development);
        }
    }
    let resources = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;
    let bundled = resources.join("voice-host");
    if bundled.join("uv.lock").exists() {
        return Ok(bundled);
    }
    Err("Packaged Voice Host resources are missing".into())
}

async fn copy_runtime_project(source: &Path, destination: &Path) -> Result<(), String> {
    tokio::fs::create_dir_all(destination)
        .await
        .map_err(|error| error.to_string())?;
    let mut pending = vec![(source.to_path_buf(), destination.to_path_buf())];
    while let Some((from, to)) = pending.pop() {
        let mut entries = tokio::fs::read_dir(&from)
            .await
            .map_err(|error| error.to_string())?;
        while let Some(entry) = entries
            .next_entry()
            .await
            .map_err(|error| error.to_string())?
        {
            let name = entry.file_name();
            if name == ".venv"
                || name == "__pycache__"
                || name == ".pytest_cache"
                || name == "tests"
                || name == ".build-temp"
                || name.to_string_lossy().starts_with("pytest-cache")
            {
                continue;
            }
            let source_path = entry.path();
            let target_path = to.join(&name);
            let kind = entry.file_type().await.map_err(|error| error.to_string())?;
            if kind.is_dir() {
                tokio::fs::create_dir_all(&target_path)
                    .await
                    .map_err(|error| error.to_string())?;
                pending.push((source_path, target_path));
            } else if kind.is_file() {
                tokio::fs::copy(&source_path, &target_path)
                    .await
                    .map_err(|error| error.to_string())?;
            }
        }
    }
    Ok(())
}

async fn run_uv<const N: usize>(
    uv: &Path,
    args: [&str; N],
    app: &AppHandle,
    project: &Path,
) -> Result<(), String> {
    let mut command = Command::new(uv);
    command.args(args);
    if args.first() == Some(&"sync") {
        command.arg(project);
    }
    apply_runtime_environment(&mut command, app, project)?;
    let output = command
        .output()
        .await
        .map_err(|error| format!("Run uv: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "Voice runtime setup failed ({}): {}",
            output.status,
            stderr.chars().take(1200).collect::<String>()
        ));
    }
    Ok(())
}

pub(super) fn apply_runtime_environment(
    command: &mut Command,
    app: &AppHandle,
    project: &Path,
) -> Result<(), String> {
    let speech_dir = app_data_dir(app)?.join("speech");
    command
        .env("UV_PYTHON_INSTALL_DIR", speech_dir.join("runtime/python"))
        .env("UV_PYTHON_PREFERENCE", "only-managed")
        .env("UV_CACHE_DIR", speech_dir.join("cache/uv"))
        .env("UV_NO_CONFIG", "1")
        .env("UV_PROJECT_ENVIRONMENT", project.join(".venv"))
        .env("HF_HOME", speech_dir.join("models/pocket/huggingface"))
        .env(
            "HUGGINGFACE_HUB_CACHE",
            speech_dir.join("models/pocket/huggingface/hub"),
        )
        .env("CUDA_VISIBLE_DEVICES", "")
        .env("OMP_NUM_THREADS", "2")
        .env("MKL_NUM_THREADS", "2")
        .env("OPENBLAS_NUM_THREADS", "2");
    Ok(())
}

async fn ensure_uv(speech_dir: &Path, app: &AppHandle) -> Result<PathBuf, String> {
    let name = if cfg!(windows) { "uv.exe" } else { "uv" };
    let destination = speech_dir.join("runtime").join(name);
    if tokio::fs::try_exists(&destination).await.unwrap_or(false) {
        return Ok(destination);
    }
    emit_progress(app, "runtime", "Downloading the verified runtime installer");
    let (asset, expected_hash, archive) = uv_asset()?;
    let url = format!("https://github.com/astral-sh/uv/releases/download/{UV_VERSION}/{asset}");
    let bytes = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|error| error.to_string())?
        .get(url)
        .send()
        .await
        .map_err(|error| format!("Download uv: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Download uv: {error}"))?
        .bytes()
        .await
        .map_err(|error| error.to_string())?;
    let actual = format!("{:x}", Sha256::digest(&bytes));
    if actual != expected_hash {
        return Err(format!("uv archive checksum mismatch: {actual}"));
    }
    tokio::fs::create_dir_all(destination.parent().ok_or("Invalid runtime path")?)
        .await
        .map_err(|error| error.to_string())?;
    let temporary = speech_dir.join("runtime/uv-download");
    tokio::fs::create_dir_all(&temporary)
        .await
        .map_err(|error| error.to_string())?;
    if archive == "zip" {
        let mut zip = zip::ZipArchive::new(Cursor::new(bytes))
            .map_err(|error| format!("Open uv archive: {error}"))?;
        let mut binary = zip
            .by_name(name)
            .map_err(|error| format!("Find uv executable: {error}"))?;
        let mut file = std::fs::File::create(&destination).map_err(|error| error.to_string())?;
        std::io::copy(&mut binary, &mut file).map_err(|error| error.to_string())?;
    } else {
        let archive_path = temporary.join("uv.tar.gz");
        tokio::fs::write(&archive_path, &bytes)
            .await
            .map_err(|error| error.to_string())?;
        let status = Command::new("tar")
            .args(["-xzf"])
            .arg(&archive_path)
            .arg("-C")
            .arg(&temporary)
            .status()
            .await
            .map_err(|error| format!("Extract uv archive: {error}"))?;
        if !status.success() {
            return Err(format!("Extract uv archive failed: {status}"));
        }
        let extracted = find_named_file(&temporary, name).await?;
        tokio::fs::copy(extracted, &destination)
            .await
            .map_err(|error| error.to_string())?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = std::fs::metadata(&destination)
            .map_err(|error| error.to_string())?
            .permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&destination, permissions).map_err(|error| error.to_string())?;
    }
    let _ = tokio::fs::remove_dir_all(&temporary).await;
    Ok(destination)
}

pub(super) fn emit_progress(app: &AppHandle, phase: &str, message: &str) {
    if let Err(error) = app.emit(
        "voice-runtime-progress",
        serde_json::json!({"phase":phase,"message":message}),
    ) {
        tracing::warn!("Could not publish speech runtime progress: {error}");
    }
}

async fn find_named_file(root: &Path, name: &str) -> Result<PathBuf, String> {
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        let mut entries = tokio::fs::read_dir(directory)
            .await
            .map_err(|error| error.to_string())?;
        while let Some(entry) = entries
            .next_entry()
            .await
            .map_err(|error| error.to_string())?
        {
            let path = entry.path();
            if entry
                .file_type()
                .await
                .map_err(|error| error.to_string())?
                .is_dir()
            {
                pending.push(path);
            } else if entry.file_name() == name {
                return Ok(path);
            }
        }
    }
    Err(format!("uv archive did not contain {name}"))
}

fn uv_asset() -> Result<(&'static str, &'static str, &'static str), String> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") => Ok((
            "uv-x86_64-pc-windows-msvc.zip",
            "cae6a3bc25239f83dffb467a4b180508d9da23986c04639ebfa44e43e6a84bff",
            "zip",
        )),
        ("linux", "x86_64") => Ok((
            "uv-x86_64-unknown-linux-gnu.tar.gz",
            "89eadd7c76fc063887959510d5ba0ab1264dfd5f1143b925ddb73021a40acf16",
            "tar.gz",
        )),
        ("linux", "aarch64") => Ok((
            "uv-aarch64-unknown-linux-gnu.tar.gz",
            "afb6291f3f0a6b4521fc67b947822506c41dde5b60d2189dd8f3695b2ac8c9e7",
            "tar.gz",
        )),
        ("macos", "aarch64") => Ok((
            "uv-aarch64-apple-darwin.tar.gz",
            "cf40e0c6a202190ccd9e0406dcfdd5b2d6668a9a5c779b17948963df32aafe5b",
            "tar.gz",
        )),
        ("macos", "x86_64") => Ok((
            "uv-x86_64-apple-darwin.tar.gz",
            "2e4108f5395397c8bc5d43bf83d3bdbb2d0e92b90d0efa607756be704905fa33",
            "tar.gz",
        )),
        _ => Err("No pinned uv runtime is available for this platform".into()),
    }
}
