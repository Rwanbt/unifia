use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use ring::hmac;
use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};

pub(crate) fn create_jwt(api_secret: &str, claims: Value) -> Result<String, String> {
    let header = URL_SAFE_NO_PAD.encode(br#"{"alg":"HS256","typ":"JWT"}"#);
    let payload = URL_SAFE_NO_PAD.encode(
        serde_json::to_vec(&claims).map_err(|error| format!("Serialize LiveKit token: {error}"))?,
    );
    let message = format!("{header}.{payload}");
    let signing_key = hmac::Key::new(hmac::HMAC_SHA256, api_secret.as_bytes());
    let signature = hmac::sign(&signing_key, message.as_bytes());
    Ok(format!(
        "{message}.{}",
        URL_SAFE_NO_PAD.encode(signature.as_ref())
    ))
}

pub(crate) fn unix_time() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .map_err(|error| format!("System clock is before Unix epoch: {error}"))
}
