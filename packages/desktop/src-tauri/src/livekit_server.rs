use sha2::{Digest, Sha256};
#[cfg(unix)]
use std::fs;
#[cfg(any(windows, target_os = "linux"))]
use std::io::{Cursor, Read};
use std::{
    fs::OpenOptions,
    net::{Ipv4Addr, UdpSocket},
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::{AppHandle, Manager};
use tokio::{
    net::TcpStream,
    process::{Child, Command},
    time::{sleep, timeout},
};

const LIVEKIT_VERSION: &str = "1.13.7";
const LIVEKIT_HTTP_PORT: u16 = 7880;
const LIVEKIT_RTC_PORT: u16 = 7882;
const PRIVATE_ROUTE_PROBES: [Ipv4Addr; 3] = [
    Ipv4Addr::new(192, 168, 1, 1),
    Ipv4Addr::new(10, 0, 0, 1),
    Ipv4Addr::new(172, 16, 0, 1),
];
#[cfg(all(target_os = "windows", target_arch = "x86_64"))]
const LIVEKIT_WINDOWS_SHA256: &str =
    "951f9466cd4450b3c3c7f1a5830a05a9bb97cc11d93cf1be9ebcd3b47cc316d1";
#[cfg(all(target_os = "windows", target_arch = "x86_64"))]
const LIVEKIT_WIN_AMD64_ARCHIVE_SHA256: &str =
    "e539e7d2f75807b9c9202cd2a0bf2cb3d52fc4c52978a6953e0f47bc339fe77f";
#[cfg(all(target_os = "windows", target_arch = "aarch64"))]
const LIVEKIT_WIN_ARM64_ARCHIVE_SHA256: &str =
    "8379c89b9973dc52577710b293f6190644bd6fad0c415df4279a24ea54df2363";
#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
const LIVEKIT_LINUX_AMD64_ARCHIVE_SHA256: &str =
    "6634aeeb2fb1366b6723708ae4320b9d5408106a4c63457c5e845ae3979c90e2";
#[cfg(all(target_os = "linux", target_arch = "aarch64"))]
const LIVEKIT_LINUX_ARM64_ARCHIVE_SHA256: &str =
    "5d167fdf52cf43c0c72972f25325364479f41f854bfef651056eab2504da5de9";

pub(crate) async fn resolve_path(app: &AppHandle) -> Result<PathBuf, String> {
    #[cfg(all(debug_assertions, target_os = "windows", target_arch = "x86_64"))]
    {
        let development = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../voice-host/.build-temp/livekit-1.13.7")
            .join(executable_name());
        if development.is_file() && binary_sha256(&development).await? == LIVEKIT_WINDOWS_SHA256 {
            return Ok(development);
        }
    }
    install(app).await
}

fn executable_name() -> &'static str {
    if cfg!(windows) {
        "livekit-server.exe"
    } else {
        "livekit-server"
    }
}

pub(crate) async fn verify(path: &Path) -> Result<(), String> {
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        let actual = binary_sha256(path).await?;
        if actual != LIVEKIT_WINDOWS_SHA256 {
            return Err("LiveKit server checksum does not match the pinned release".into());
        }
    }
    let version = Command::new(path)
        .arg("--version")
        .output()
        .await
        .map_err(|error| format!("Check LiveKit server version: {error}"))?;
    let output = String::from_utf8_lossy(&version.stdout);
    if !version.status.success() || !output.contains(LIVEKIT_VERSION) {
        return Err("LiveKit server version does not match the pinned release".into());
    }
    Ok(())
}

#[cfg(all(target_os = "windows", target_arch = "x86_64"))]
async fn binary_sha256(path: &Path) -> Result<String, String> {
    let bytes = tokio::fs::read(path)
        .await
        .map_err(|error| format!("Read LiveKit server: {error}"))?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

async fn install(app: &AppHandle) -> Result<PathBuf, String> {
    let (asset, expected_sha256, archive_extension) = release_asset()?;
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let install_dir = app_data
        .join("speech")
        .join("livekit")
        .join(LIVEKIT_VERSION);
    tokio::fs::create_dir_all(&install_dir)
        .await
        .map_err(|error| format!("Create LiveKit runtime directory: {error}"))?;
    let archive_path = install_dir.join(format!("{asset}.{archive_extension}"));
    let mut archive = if archive_path.is_file() {
        tokio::fs::read(&archive_path)
            .await
            .map_err(|error| format!("Read cached LiveKit release: {error}"))?
    } else {
        Vec::new()
    };
    if verify_archive_sha256(&archive, expected_sha256).is_err() {
        if archive_path.is_file() {
            tracing::warn!(path = %archive_path.display(), "discarding cached LiveKit release with an invalid checksum");
            tokio::fs::remove_file(&archive_path)
                .await
                .map_err(|error| format!("Remove invalid LiveKit cache: {error}"))?;
        }
        let url = format!(
            "https://github.com/livekit/livekit/releases/download/v{LIVEKIT_VERSION}/{asset}"
        );
        let response = reqwest::Client::builder()
            .timeout(Duration::from_secs(120))
            .build()
            .map_err(|error| format!("Build LiveKit downloader: {error}"))?
            .get(url)
            .send()
            .await
            .map_err(|error| format!("Download official LiveKit runtime: {error}"))?
            .error_for_status()
            .map_err(|error| format!("Download official LiveKit runtime: {error}"))?;
        let content_length = response
            .content_length()
            .filter(|length| *length <= 64 * 1024 * 1024)
            .ok_or_else(|| "LiveKit archive has no acceptable content length".to_string())?;
        let bytes = response
            .bytes()
            .await
            .map_err(|error| format!("Read official LiveKit runtime: {error}"))?;
        if bytes.len() as u64 != content_length {
            return Err("LiveKit archive size differs from its declared content length".into());
        }
        archive = bytes.to_vec();
        verify_archive_sha256(&archive, expected_sha256)?;
        let temporary = archive_path.with_extension(format!("{archive_extension}.partial"));
        tokio::fs::write(&temporary, &archive)
            .await
            .map_err(|error| format!("Cache LiveKit release: {error}"))?;
        tokio::fs::rename(&temporary, &archive_path)
            .await
            .map_err(|error| format!("Install LiveKit release cache: {error}"))?;
    }
    verify_archive_sha256(&archive, expected_sha256)?;
    let executable = extract_executable(&archive, archive_extension)?;
    let executable_path = install_dir.join(executable_name());
    let temporary = executable_path.with_extension("installing");
    tokio::fs::write(&temporary, executable)
        .await
        .map_err(|error| format!("Write LiveKit server binary: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        tokio::fs::set_permissions(&temporary, fs::Permissions::from_mode(0o700))
            .await
            .map_err(|error| format!("Set LiveKit server permissions: {error}"))?;
    }
    if executable_path.is_file() {
        tokio::fs::remove_file(&executable_path)
            .await
            .map_err(|error| format!("Replace managed LiveKit server: {error}"))?;
    }
    tokio::fs::rename(&temporary, &executable_path)
        .await
        .map_err(|error| format!("Activate LiveKit server binary: {error}"))?;
    Ok(executable_path)
}

fn release_asset() -> Result<(&'static str, &'static str, &'static str), String> {
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    return Ok((
        "livekit_1.13.7_windows_amd64.zip",
        LIVEKIT_WIN_AMD64_ARCHIVE_SHA256,
        "zip",
    ));
    #[cfg(all(target_os = "windows", target_arch = "aarch64"))]
    return Ok((
        "livekit_1.13.7_windows_arm64.zip",
        LIVEKIT_WIN_ARM64_ARCHIVE_SHA256,
        "zip",
    ));
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    return Ok((
        "livekit_1.13.7_linux_amd64.tar.gz",
        LIVEKIT_LINUX_AMD64_ARCHIVE_SHA256,
        "tar.gz",
    ));
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    return Ok((
        "livekit_1.13.7_linux_arm64.tar.gz",
        LIVEKIT_LINUX_ARM64_ARCHIVE_SHA256,
        "tar.gz",
    ));
    #[allow(unreachable_code)]
    Err("LiveKit does not publish a pinned server artifact for this platform".into())
}

fn verify_archive_sha256(bytes: &[u8], expected: &str) -> Result<(), String> {
    let actual = format!("{:x}", Sha256::digest(bytes));
    if actual == expected {
        Ok(())
    } else {
        Err("LiveKit release archive checksum does not match its pinned digest".into())
    }
}

fn extract_executable(archive: &[u8], extension: &str) -> Result<Vec<u8>, String> {
    #[cfg(windows)]
    if extension == "zip" {
        let mut zip = zip::ZipArchive::new(Cursor::new(archive))
            .map_err(|error| format!("Open LiveKit release archive: {error}"))?;
        for index in 0..zip.len() {
            let mut entry = zip
                .by_index(index)
                .map_err(|error| format!("Read LiveKit archive entry: {error}"))?;
            if entry.name() == "livekit-server.exe" {
                let mut bytes = Vec::new();
                entry
                    .read_to_end(&mut bytes)
                    .map_err(|error| format!("Extract LiveKit executable: {error}"))?;
                return Ok(bytes);
            }
        }
        return Err("LiveKit executable is absent from the verified release archive".into());
    }
    #[cfg(target_os = "linux")]
    if extension == "tar.gz" {
        let decoder = flate2::read::GzDecoder::new(Cursor::new(archive));
        let mut tar = tar::Archive::new(decoder);
        for item in tar
            .entries()
            .map_err(|error| format!("Read LiveKit archive entries: {error}"))?
        {
            let mut entry = item.map_err(|error| format!("Read LiveKit archive entry: {error}"))?;
            if entry.path().is_ok_and(|path| {
                path.file_name()
                    .is_some_and(|name| name == "livekit-server")
            }) {
                let mut bytes = Vec::new();
                entry
                    .read_to_end(&mut bytes)
                    .map_err(|error| format!("Extract LiveKit executable: {error}"))?;
                return Ok(bytes);
            }
        }
        return Err("LiveKit executable is absent from the verified release archive".into());
    }
    Err("Unsupported LiveKit archive format for this platform".into())
}

pub(crate) async fn write_config(
    path: &Path,
    api_key: &str,
    api_secret: &str,
    host_mode: HostMode,
) -> Result<(), String> {
    let content = config_contents(api_key, api_secret, host_mode)?;
    tokio::fs::write(path, content)
        .await
        .map_err(|error| format!("Write ephemeral LiveKit config: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Err(error) =
            tokio::fs::set_permissions(path, fs::Permissions::from_mode(0o600)).await
        {
            let _ = tokio::fs::remove_file(path).await;
            return Err(format!("Protect ephemeral LiveKit config: {error}"));
        }
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum HostMode {
    Local,
    Lan,
}

impl HostMode {
    pub(crate) fn parse(value: &str) -> Result<Self, String> {
        match value {
            "local" => Ok(Self::Local),
            "lan" => Ok(Self::Lan),
            _ => Err("Invalid LiveKit host mode".into()),
        }
    }
}

fn config_contents(api_key: &str, api_secret: &str, host_mode: HostMode) -> Result<String, String> {
    let lan_ip = match host_mode {
        HostMode::Local => None,
        HostMode::Lan => Some(detect_private_lan_ip().ok_or_else(|| {
            "LAN Voice mode requires an active private IPv4 interface".to_string()
        })?),
    };
    Ok(config_with_lan_ip(api_key, api_secret, lan_ip))
}

fn config_with_lan_ip(api_key: &str, api_secret: &str, lan_ip: Option<Ipv4Addr>) -> String {
    let (bind_addresses, node_ip, stun_servers, candidate_ranges) = match lan_ip {
        Some(address) => (
            format!("  - 127.0.0.1\n  - ::1\n  - {address}\n"),
            address.to_string(),
            format!("    - 127.0.0.1:{LIVEKIT_RTC_PORT}\n    - {address}:{LIVEKIT_RTC_PORT}\n"),
            format!("      - {address}/32\n"),
        ),
        None => (
            "  - 127.0.0.1\n  - ::1\n".into(),
            "127.0.0.1".into(),
            format!("    - 127.0.0.1:{LIVEKIT_RTC_PORT}\n"),
            String::new(),
        ),
    };
    format!(
        "port: {LIVEKIT_HTTP_PORT}\nbind_addresses:\n{bind_addresses}rtc:\n  tcp_port: 0\n  udp_port: {LIVEKIT_RTC_PORT}\n  node_ip: {node_ip}\n  use_external_ip: false\n  enable_loopback_candidate: true\n  stun_servers:\n{stun_servers}  ips:\n    includes:\n      - 127.0.0.0/8\n      - ::1/128\n{candidate_ranges}keys:\n  \"{api_key}\": \"{api_secret}\"\nlogging:\n  level: warn\n"
    )
}

fn detect_private_lan_ip() -> Option<Ipv4Addr> {
    for destination in PRIVATE_ROUTE_PROBES {
        let Ok(socket) = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)) else {
            continue;
        };
        if socket.connect((destination, 80)).is_err() {
            continue;
        }
        let Ok(local_address) = socket.local_addr() else {
            continue;
        };
        let address = local_address.ip();
        if let std::net::IpAddr::V4(address) = address
            && address.is_private()
            && !address.is_loopback()
            && !address.is_link_local()
        {
            return Some(address);
        }
    }
    None
}

pub(crate) fn open_log(path: &Path) -> Result<std::fs::File, String> {
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| format!("Open voice runtime log: {error}"))
}

pub(crate) async fn wait_for_server(server: &mut Child) -> Result<(), String> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    loop {
        if server
            .try_wait()
            .map_err(|error| error.to_string())?
            .is_some()
        {
            return Err("LiveKit server exited during startup; see livekit.log".into());
        }
        if timeout(
            Duration::from_millis(250),
            TcpStream::connect("127.0.0.1:7880"),
        )
        .await
        .is_ok_and(|result| result.is_ok())
        {
            return Ok(());
        }
        if tokio::time::Instant::now() >= deadline {
            return Err("LiveKit server did not listen on localhost:7880".into());
        }
        sleep(Duration::from_millis(100)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::{HostMode, config_with_lan_ip};
    use std::net::Ipv4Addr;

    #[test]
    fn runtime_config_scopes_rtc_to_loopback() {
        let config = config_with_lan_ip("test-key", "test-secret", None);

        assert!(config.contains("  - 127.0.0.1\n  - ::1\n"));
        assert!(config.contains("  tcp_port: 0\n"));
        assert!(config.contains("  enable_loopback_candidate: true\n"));
        assert!(config.contains("  stun_servers:\n    - 127.0.0.1:7882\n"));
        assert!(config.contains("    includes:\n      - 127.0.0.0/8\n      - ::1/128\n"));
        assert!(!config.contains("0.0.0.0"));
        assert!(!config.contains("node_ip: 0.0.0.0"));
    }

    #[test]
    fn lan_config_binds_only_the_selected_private_address() {
        let address = Ipv4Addr::new(192, 168, 1, 42);
        let config = config_with_lan_ip("test-key", "test-secret", Some(address));

        assert!(config.contains("  - 127.0.0.1\n  - ::1\n  - 192.168.1.42\n"));
        assert!(config.contains("  node_ip: 192.168.1.42\n"));
        assert!(config.contains("      - 192.168.1.42/32\n"));
        assert!(!config.contains("0.0.0.0"));
        assert!(!config.contains("8.8.8.8"));
    }

    #[test]
    fn host_mode_parser_rejects_unrecognized_network_scopes() {
        assert_eq!(HostMode::parse("local").unwrap(), HostMode::Local);
        assert_eq!(HostMode::parse("lan").unwrap(), HostMode::Lan);
        assert!(HostMode::parse("internet").is_err());
    }
}
