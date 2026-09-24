// SPDX-License-Identifier: MIT
//! LiveKit SFU configuration for the Live Voice Host.
//!
//! Pure functions so the network exposure rules are unit-tested: loopback by
//! default, one private LAN address only when the user enables LAN access, no
//! TCP ICE fallback (it binds every interface), no TURN.

use serde::{Deserialize, Serialize};
use std::net::{IpAddr, Ipv4Addr, UdpSocket};

pub(crate) const SIGNAL_PORT: u16 = 17880;
pub(crate) const RTC_UDP_PORT: u16 = 17882;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum VoiceHostMode {
    Local,
    Lan,
}

impl VoiceHostMode {
    pub(crate) fn parse(value: &str) -> Result<Self, String> {
        match value {
            "local" => Ok(Self::Local),
            "lan" => Ok(Self::Lan),
            other => Err(format!("Unknown Voice Host mode: {other}")),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LiveKitCredentials {
    pub api_key: String,
    pub api_secret: String,
}

impl LiveKitCredentials {
    pub(crate) fn generate() -> Self {
        let key = uuid::Uuid::new_v4().simple().to_string();
        let secret = format!(
            "{}{}",
            uuid::Uuid::new_v4().simple(),
            uuid::Uuid::new_v4().simple()
        );
        Self {
            api_key: format!("APIunifia{}", &key[..12]),
            api_secret: secret,
        }
    }

    pub(crate) fn is_valid(&self) -> bool {
        self.api_key.len() >= 8
            && self.api_secret.len() >= 32
            && self.api_key.chars().all(|c| c.is_ascii_alphanumeric())
            && self.api_secret.chars().all(|c| c.is_ascii_alphanumeric())
    }
}

pub(crate) fn is_private_lan(ip: Ipv4Addr) -> bool {
    ip.is_private() && !ip.is_loopback()
}

/// The private IPv4 address of the interface holding the default route.
///
/// A connected UDP socket sends nothing; the kernel only resolves the route.
pub(crate) fn detect_lan_ipv4() -> Option<Ipv4Addr> {
    let socket = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).ok()?;
    socket.connect((Ipv4Addr::new(192, 168, 0, 1), 9)).ok()?;
    match socket.local_addr().ok()?.ip() {
        IpAddr::V4(ip) if is_private_lan(ip) => Some(ip),
        _ => None,
    }
}

pub(crate) struct ServerConfig<'a> {
    pub credentials: &'a LiveKitCredentials,
    pub lan: Option<Ipv4Addr>,
}

impl ServerConfig<'_> {
    pub(crate) fn signal_url(&self) -> String {
        format!("ws://127.0.0.1:{SIGNAL_PORT}")
    }

    pub(crate) fn lan_url(&self) -> Option<String> {
        self.lan.map(|ip| format!("ws://{ip}:{SIGNAL_PORT}"))
    }

    /// livekit-server YAML. Every value is generated here (no user text), so
    /// plain formatting cannot inject YAML.
    pub(crate) fn to_yaml(&self) -> String {
        let mut binds = vec!["127.0.0.1".to_string()];
        let mut includes = vec!["127.0.0.1/32".to_string()];
        let mut node_ip = "127.0.0.1".to_string();
        if let Some(ip) = self.lan {
            binds.push(ip.to_string());
            includes.push(format!("{ip}/32"));
            node_ip = ip.to_string();
        }
        let mut lines = vec![format!("port: {SIGNAL_PORT}"), "bind_addresses:".to_string()];
        lines.extend(binds.iter().map(|bind| format!("  - {bind}")));
        lines.extend([
            "rtc:".to_string(),
            format!("  udp_port: {RTC_UDP_PORT}"),
            "  tcp_port: 0".to_string(),
            "  use_external_ip: false".to_string(),
            "  # pion drops loopback candidates unless this is set; without it a local".to_string(),
            "  # client never forms an ICE pair (wait_pc_connection timed out).".to_string(),
            "  enable_loopback_candidate: true".to_string(),
            format!("  node_ip: {node_ip}"),
            "  ips:".to_string(),
            "    includes:".to_string(),
        ]);
        lines.extend(includes.iter().map(|range| format!("      - {range}")));
        lines.extend([
            "keys:".to_string(),
            format!("  {}: {}", self.credentials.api_key, self.credentials.api_secret),
            "room:".to_string(),
            "  auto_create: true".to_string(),
            "  empty_timeout: 120".to_string(),
            "  departure_timeout: 120".to_string(),
            "  max_participants: 2".to_string(),
            "turn:".to_string(),
            "  enabled: false".to_string(),
            "logging:".to_string(),
            "  level: info".to_string(),
        ]);
        lines.join("\n") + "\n"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn creds() -> LiveKitCredentials {
        LiveKitCredentials {
            api_key: "APIunifiatest".into(),
            api_secret: "s".repeat(64),
        }
    }

    #[test]
    fn local_mode_binds_loopback_only() {
        let credentials = creds();
        let yaml = ServerConfig { credentials: &credentials, lan: None }.to_yaml();
        assert!(yaml.contains("bind_addresses:\n  - 127.0.0.1\nrtc:"));
        assert!(yaml.contains("node_ip: 127.0.0.1"));
        assert!(yaml.contains("includes:\n      - 127.0.0.1/32\nkeys:"));
        assert!(yaml.contains("tcp_port: 0"));
        assert!(yaml.contains("enable_loopback_candidate: true"));
        assert!(yaml.contains("turn:\n  enabled: false"));
        assert!(!yaml.contains("0.0.0.0"));
    }

    #[test]
    fn lan_mode_adds_exactly_one_private_address() {
        let credentials = creds();
        let config = ServerConfig {
            credentials: &credentials,
            lan: Some(Ipv4Addr::new(192, 168, 1, 20)),
        };
        let yaml = config.to_yaml();
        assert!(yaml.contains("  - 127.0.0.1\n  - 192.168.1.20\n"));
        assert!(yaml.contains("node_ip: 192.168.1.20"));
        assert!(yaml.contains("      - 192.168.1.20/32\n"));
        assert_eq!(config.lan_url().as_deref(), Some("ws://192.168.1.20:17880"));
    }

    #[test]
    fn only_private_non_loopback_addresses_qualify_for_lan() {
        assert!(is_private_lan(Ipv4Addr::new(10, 0, 0, 5)));
        assert!(is_private_lan(Ipv4Addr::new(172, 20, 1, 1)));
        assert!(!is_private_lan(Ipv4Addr::new(8, 8, 8, 8)));
        assert!(!is_private_lan(Ipv4Addr::new(127, 0, 0, 1)));
    }

    #[test]
    fn generated_credentials_are_yaml_safe() {
        let credentials = LiveKitCredentials::generate();
        assert!(credentials.is_valid());
        assert_ne!(credentials, LiveKitCredentials::generate());
    }

    #[test]
    fn mode_parsing_is_strict() {
        assert_eq!(VoiceHostMode::parse("local"), Ok(VoiceHostMode::Local));
        assert_eq!(VoiceHostMode::parse("lan"), Ok(VoiceHostMode::Lan));
        assert!(VoiceHostMode::parse("internet").is_err());
    }
}
