const DEFAULT_ANDROID_PTY_PORT: u16 = 14098;

pub(super) fn android_pty_port(value: Option<&str>) -> Result<u16, String> {
    let port = value
        .map(str::parse::<u16>)
        .transpose()
        .map_err(|_| "UNIFIA_PTY_PORT must be an integer from 1 to 65535".to_string())?
        .unwrap_or(DEFAULT_ANDROID_PTY_PORT);
    if port == 0 {
        return Err("UNIFIA_PTY_PORT must be an integer from 1 to 65535".to_string());
    }
    Ok(port)
}

#[cfg(test)]
mod tests {
    use super::android_pty_port;

    #[test]
    fn pty_port_uses_default_and_valid_build_override() {
        assert_eq!(android_pty_port(None).unwrap(), 14098);
        assert_eq!(android_pty_port(Some("14198")).unwrap(), 14198);
        assert!(android_pty_port(Some("0")).is_err());
        assert!(android_pty_port(Some("70000")).is_err());
        assert!(android_pty_port(Some("not-a-port")).is_err());
    }
}
