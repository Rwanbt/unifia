use std::future::Future;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Copy)]
pub(crate) struct SynthesisRequest<'a> {
    pub app: &'a AppHandle,
    pub text: &'a str,
    pub language: &'a str,
    pub voice: &'a str,
    pub voice_sample: Option<&'a Path>,
    pub provider: Option<&'a str>,
    pub speed: f32,
    pub output: &'a Path,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Provider {
    Pocket,
    Piper,
}

impl Provider {
    fn parse(preference: Option<&str>) -> Result<Option<Self>, String> {
        match preference.unwrap_or("auto") {
            "auto" => Ok(None),
            "pocket" => Ok(Some(Self::Pocket)),
            "piper" => Ok(Some(Self::Piper)),
            _ => Err("unsupported TTS provider".into()),
        }
    }
}

pub struct TtsRouter {
    pocket: crate::voice_runtime::VoiceRuntime,
    piper: crate::piper_runtime::PiperRuntime,
    forced_pocket_error: Option<String>,
    request: tokio::sync::Mutex<()>,
    active_provider: tokio::sync::Mutex<Option<Provider>>,
    cancelled: AtomicBool,
}

impl TtsRouter {
    pub fn new() -> Self {
        Self::with_forced_pocket_error(None)
    }

    pub(crate) fn new_for_fallback_qualification() -> Self {
        Self::with_forced_pocket_error(Some(
            "Pocket worker deliberately unavailable for fallback qualification".into(),
        ))
    }

    fn with_forced_pocket_error(forced_pocket_error: Option<String>) -> Self {
        Self {
            pocket: crate::voice_runtime::VoiceRuntime::new(),
            piper: crate::piper_runtime::PiperRuntime::new(),
            forced_pocket_error,
            request: tokio::sync::Mutex::new(()),
            active_provider: tokio::sync::Mutex::new(None),
            cancelled: AtomicBool::new(false),
        }
    }

    pub(crate) fn pocket_runtime(&self) -> &crate::voice_runtime::VoiceRuntime {
        &self.pocket
    }

    pub(crate) async fn qualification_piper_worker_pid(&self) -> Result<u32, String> {
        self.piper.qualification_worker_pid().await
    }

    pub(crate) async fn qualification_kill_piper_when_busy(&self) -> Result<u32, String> {
        self.piper.qualification_kill_when_busy().await
    }

    pub(crate) async fn qualification_cancel_piper_when_busy(&self) -> Result<(), String> {
        self.piper.qualification_wait_until_synthesizing().await?;
        self.cancel().await
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
        let selected = Provider::parse(request.provider)?;
        if let Some(selected) = selected {
            return self.synthesize_with(selected, request).await;
        }

        if request.voice_sample.is_some() {
            return self
                .synthesize_with(Provider::Pocket, request)
                .await
                .map_err(|error| {
                    format!(
                        "Pocket voice-clone synthesis failed; Piper cannot reproduce this clone: {error}"
                    )
                });
        }
        let (metrics, reason) = automatic_fallback(
            || async {
                if let Some(reason) = &self.forced_pocket_error {
                    return Err(reason.clone());
                }
                self.synthesize_with(Provider::Pocket, request).await
            },
            |reason| async move {
                if self.cancelled.load(Ordering::Acquire) {
                    return Err("TTS request cancelled before Piper fallback".into());
                }
                tracing::warn!("[TTS] Pocket failed; falling back to Piper: {reason}");
                if let Err(emit_error) = request
                    .app
                    .emit("voice-provider-fallback", fallback_event(&reason))
                {
                    tracing::warn!("Could not publish TTS fallback reason: {emit_error}");
                }
                self.synthesize_with(Provider::Piper, request).await
            },
        )
        .await?;
        if let Some(reason) = reason {
            tracing::info!("[TTS] Automatic provider fallback reason: {reason}");
        }
        Ok(metrics)
    }

    async fn synthesize_with(
        &self,
        provider: Provider,
        request: SynthesisRequest<'_>,
    ) -> Result<crate::voice_runtime::SynthesisMetrics, String> {
        if self.cancelled.load(Ordering::Acquire) {
            return Err("TTS request cancelled before provider startup".into());
        }
        *self.active_provider.lock().await = Some(provider);
        if self.cancelled.load(Ordering::Acquire) {
            *self.active_provider.lock().await = None;
            return Err("TTS request cancelled before provider startup".into());
        }
        let result = match provider {
            Provider::Pocket => {
                self.pocket
                    .synthesize(
                        request.app,
                        request.text,
                        request.language,
                        request.voice,
                        request.voice_sample,
                        request.output,
                    )
                    .await
            }
            Provider::Piper => {
                if request.voice_sample.is_some() {
                    Err("Piper does not support Pocket voice clones".into())
                } else {
                    self.piper
                        .synthesize(
                            request.app,
                            request.text,
                            request.language,
                            request.voice,
                            request.speed,
                            request.output,
                        )
                        .await
                }
            }
        };
        *self.active_provider.lock().await = None;
        if self.cancelled.load(Ordering::Acquire) {
            return Err("TTS request cancelled".into());
        }
        result
    }

    pub async fn cancel(&self) -> Result<(), String> {
        self.cancelled.store(true, Ordering::Release);
        match *self.active_provider.lock().await {
            Some(Provider::Pocket) => self.pocket.cancel().await,
            Some(Provider::Piper) => self.piper.cancel().await,
            None => Ok(()),
        }
    }

    pub async fn stop(&self) -> Result<(), String> {
        let pocket = self.pocket.stop().await;
        let piper = self.piper.stop().await;
        pocket.and(piper)
    }
}

fn fallback_event(reason: &str) -> serde_json::Value {
    serde_json::json!({"from":"pocket","to":"piper","reason":reason})
}

async fn automatic_fallback<T, Primary, PrimaryFuture, Fallback, FallbackFuture>(
    primary: Primary,
    fallback: Fallback,
) -> Result<(T, Option<String>), String>
where
    Primary: FnOnce() -> PrimaryFuture,
    PrimaryFuture: Future<Output = Result<T, String>>,
    Fallback: FnOnce(String) -> FallbackFuture,
    FallbackFuture: Future<Output = Result<T, String>>,
{
    match primary().await {
        Ok(result) => Ok((result, None)),
        Err(reason) => fallback(reason.clone())
            .await
            .map(|result| (result, Some(reason))),
    }
}

#[cfg(test)]
mod tests {
    use super::{Provider, automatic_fallback};

    #[test]
    fn auto_is_the_only_fallback_mode() {
        assert_eq!(Provider::parse(None).expect("default preference"), None);
        assert_eq!(
            Provider::parse(Some("auto")).expect("auto preference"),
            None
        );
        assert_eq!(
            Provider::parse(Some("pocket")).expect("explicit Pocket"),
            Some(Provider::Pocket)
        );
        assert_eq!(
            Provider::parse(Some("piper")).expect("explicit Piper"),
            Some(Provider::Piper)
        );
        assert!(Provider::parse(Some("kokoro")).is_err());
    }

    #[tokio::test]
    async fn unavailable_pocket_uses_piper_and_preserves_reason() {
        let (audio, reason) = automatic_fallback(
            || async { Err("Pocket worker unavailable".to_string()) },
            |failure| async move {
                assert_eq!(failure, "Pocket worker unavailable");
                Ok(vec![0, 4, 8, 12])
            },
        )
        .await
        .expect("Piper fallback audio");

        assert_eq!(audio, vec![0, 4, 8, 12]);
        assert_eq!(reason.as_deref(), Some("Pocket worker unavailable"));
    }

    #[tokio::test]
    async fn successful_pocket_does_not_start_piper() {
        let (audio, reason) = automatic_fallback(
            || async { Ok("pocket audio") },
            |_| async { panic!("Piper must not run after Pocket succeeds") },
        )
        .await
        .expect("Pocket audio");

        assert_eq!(audio, "pocket audio");
        assert_eq!(reason, None);
    }
}
