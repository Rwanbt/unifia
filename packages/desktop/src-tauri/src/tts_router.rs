use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::AppHandle;

#[derive(Clone, Copy)]
pub(crate) struct SynthesisRequest<'a> {
    pub app: &'a AppHandle,
    pub text: &'a str,
    pub language: &'a str,
    pub voice: &'a str,
    pub voice_sample: Option<&'a Path>,
    pub provider: Option<&'a str>,
    pub output: &'a Path,
}

/// Pocket is the only bundled engine. `auto` resolves to it; any other name is
/// rejected instead of silently switching to a provider that no longer exists.
fn check_preference(preference: Option<&str>) -> Result<(), String> {
    match preference.unwrap_or("auto") {
        "auto" | "pocket" => Ok(()),
        _ => Err("unsupported TTS provider".into()),
    }
}

pub struct TtsRouter {
    pocket: crate::voice_runtime::VoiceRuntime,
    request: tokio::sync::Mutex<()>,
    active: tokio::sync::Mutex<bool>,
    cancelled: AtomicBool,
}

impl TtsRouter {
    pub fn new() -> Self {
        Self {
            pocket: crate::voice_runtime::VoiceRuntime::new(),
            request: tokio::sync::Mutex::new(()),
            active: tokio::sync::Mutex::new(false),
            cancelled: AtomicBool::new(false),
        }
    }

    pub(crate) fn pocket_runtime(&self) -> &crate::voice_runtime::VoiceRuntime {
        &self.pocket
    }

    pub async fn start_pocket(&self, app: &AppHandle) -> Result<(), String> {
        self.pocket.start(app).await
    }

    pub async fn synthesize(
        &self,
        request: SynthesisRequest<'_>,
    ) -> Result<crate::voice_runtime::SynthesisMetrics, String> {
        let _request = self.request.lock().await;
        self.cancelled.store(false, Ordering::Release);
        check_preference(request.provider)?;
        if self.cancelled.load(Ordering::Acquire) {
            return Err("TTS request cancelled before provider startup".into());
        }
        *self.active.lock().await = true;
        if self.cancelled.load(Ordering::Acquire) {
            *self.active.lock().await = false;
            return Err("TTS request cancelled before provider startup".into());
        }
        let result = self
            .pocket
            .synthesize(
                request.app,
                request.text,
                request.language,
                request.voice,
                request.voice_sample,
                request.output,
            )
            .await;
        *self.active.lock().await = false;
        if self.cancelled.load(Ordering::Acquire) {
            return Err("TTS request cancelled".into());
        }
        result
    }

    pub async fn cancel(&self) -> Result<(), String> {
        self.cancelled.store(true, Ordering::Release);
        if *self.active.lock().await {
            self.pocket.cancel().await
        } else {
            Ok(())
        }
    }

    pub async fn stop(&self) -> Result<(), String> {
        self.pocket.stop().await
    }
}

#[cfg(test)]
mod tests {
    use super::check_preference;

    #[test]
    fn only_pocket_or_auto_are_accepted() {
        assert!(check_preference(None).is_ok());
        assert!(check_preference(Some("auto")).is_ok());
        assert!(check_preference(Some("pocket")).is_ok());
        assert!(check_preference(Some("piper")).is_err());
        assert!(check_preference(Some("kokoro")).is_err());
    }
}
