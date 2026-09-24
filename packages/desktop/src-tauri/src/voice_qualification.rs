use crate::speech::{self, SpeechState};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const QUALIFICATION_TEXTS: [&str; 3] = [
    "Unifia voice qualification one.",
    "Unifia voice qualification two.",
    "Unifia voice qualification three.",
];

#[derive(Default, Serialize)]
struct QualificationReport {
    schema_version: u8,
    status: &'static str,
    packaged: bool,
    provider: &'static str,
    language: &'static str,
    startup_ms: Option<u64>,
    workers: Vec<WorkerRecord>,
    syntheses: Vec<SynthesisRecord>,
    restarts: u8,
    phase: String,
    error_category: Option<&'static str>,
    error: Option<String>,
    started_at_unix_ms: u128,
    finished_at_unix_ms: Option<u128>,
}

#[derive(Serialize)]
struct WorkerRecord {
    generation: u8,
    pid: u32,
    unexpected_exit_confirmed: bool,
}

#[derive(Serialize)]
struct SynthesisRecord {
    index: u8,
    sample_rate: u32,
    samples: usize,
    duration_ms: u64,
    first_audio_ms: u64,
    generation_ms: u64,
    wav_finalize_ms: u64,
    failure_detection_ms: Option<u64>,
    restart_ms: Option<u64>,
    retry_ms: Option<u64>,
    wav_bytes: u64,
    wav_duration_ms: u64,
    request_started_at_unix_ms: u128,
}

pub fn requested_report_path() -> Option<Result<PathBuf, String>> {
    let mut arguments = std::env::args_os().skip(1);
    let argument = arguments.next()?;
    if argument != "--internal-voice-qualification" {
        return None;
    }
    let Some(path) = arguments.next() else {
        return Some(Err("Qualification result path is required".into()));
    };
    if arguments.next().is_some() {
        return Some(Err(
            "Unexpected argument after qualification result path".into()
        ));
    }
    Some(Ok(PathBuf::from(path)))
}

pub async fn run(app: AppHandle, result_path: PathBuf) {
    let mut report = QualificationReport {
        schema_version: 1,
        status: "fail",
        packaged: true,
        provider: "pocket",
        language: "en",
        started_at_unix_ms: unix_ms(),
        ..QualificationReport::default()
    };
    let run_result = run_journey(&app, &result_path, &mut report).await;
    if let Err(error) = run_result {
        report.error_category = Some("qualification_failed");
        report.error = Some(error);
    } else {
        report.status = "pass";
        report.phase = "complete".into();
    }
    if let Err(error) = app.state::<SpeechState>().voice_runtime().stop().await {
        report.status = "fail";
        report.error_category = Some("cleanup_failed");
        report.error = Some(error);
        report.phase = "cleanup".into();
    }
    report.finished_at_unix_ms = Some(unix_ms());
    let write_result = write_report(&result_path, &report);
    let exit_code = if report.status == "pass" && write_result.is_ok() {
        0
    } else {
        if let Err(error) = write_result {
            eprintln!("Voice qualification report could not be written: {error}");
        }
        1
    };
    app.exit(exit_code);
}

async fn run_journey(
    app: &AppHandle,
    result_path: &Path,
    report: &mut QualificationReport,
) -> Result<(), String> {
    if cfg!(debug_assertions) {
        return Err("Internal packaged Voice qualification requires a release build".into());
    }
    report.phase = "isolation".into();
    verify_isolation(result_path)?;

    report.phase = "initial_startup".into();
    let startup = Instant::now();
    app.state::<SpeechState>()
        .voice_runtime()
        .start(app)
        .await?;
    report.startup_ms = Some(startup.elapsed().as_millis() as u64);
    let speech_state = app.state::<SpeechState>();
    let runtime = speech_state.voice_runtime();
    let first_pid = runtime.qualification_worker_pid().await?;
    report.workers.push(WorkerRecord {
        generation: 1,
        pid: first_pid,
        unexpected_exit_confirmed: false,
    });
    synthesize_and_validate(app, 1, &mut report.syntheses).await?;

    report.phase = "first_worker_crash".into();
    let killed_pid = runtime.qualification_kill_worker().await?;
    if killed_pid != first_pid {
        return Err("First crash targeted a different managed worker PID".into());
    }
    report.workers[0].unexpected_exit_confirmed = true;

    report.phase = "first_recovery".into();
    synthesize_and_validate(app, 2, &mut report.syntheses).await?;
    let second_pid = runtime.qualification_worker_pid().await?;
    require_new_worker(first_pid, second_pid)?;
    report.workers.push(WorkerRecord {
        generation: 2,
        pid: second_pid,
        unexpected_exit_confirmed: false,
    });
    report.restarts = 1;

    report.phase = "second_worker_crash".into();
    let killed_pid = runtime.qualification_kill_worker().await?;
    if killed_pid != second_pid {
        return Err("Second crash targeted a different managed worker PID".into());
    }
    report.workers[1].unexpected_exit_confirmed = true;

    report.phase = "second_recovery".into();
    synthesize_and_validate(app, 3, &mut report.syntheses).await?;
    let third_pid = runtime.qualification_worker_pid().await?;
    require_new_worker(first_pid, third_pid)?;
    require_new_worker(second_pid, third_pid)?;
    report.workers.push(WorkerRecord {
        generation: 3,
        pid: third_pid,
        unexpected_exit_confirmed: false,
    });
    report.restarts = 2;
    Ok(())
}

async fn synthesize_and_validate(
    app: &AppHandle,
    index: u8,
    records: &mut Vec<SynthesisRecord>,
) -> Result<(), String> {
    let request_started_at_unix_ms = unix_ms();
    let text = QUALIFICATION_TEXTS[usize::from(index - 1)];
    let (path, metrics) =
        speech::synthesize_to_file(app, text, Some("alba".into()), Some("en".into())).await?;
    let (wav_bytes, wav_duration_ms) = validate_wav(&path, index, &metrics)?;
    records.push(SynthesisRecord {
        index,
        sample_rate: metrics.sample_rate,
        samples: metrics.samples,
        duration_ms: metrics.duration_ms,
        first_audio_ms: metrics.first_audio_ms,
        generation_ms: metrics.generation_ms,
        wav_finalize_ms: metrics.wav_finalize_ms,
        failure_detection_ms: metrics.failure_detection_ms,
        restart_ms: metrics.restart_ms,
        retry_ms: metrics.retry_ms,
        wav_bytes,
        wav_duration_ms,
        request_started_at_unix_ms,
    });
    Ok(())
}

fn validate_wav(
    path: &Path,
    index: u8,
    metrics: &crate::voice_runtime::SynthesisMetrics,
) -> Result<(u64, u64), String> {
    let mut wav =
        hound::WavReader::open(path).map_err(|error| format!("Open WAV #{index}: {error}"))?;
    let spec = wav.spec();
    let samples = wav.duration();
    let mut non_zero_sample = false;
    for sample in wav.samples::<i16>() {
        if sample.map_err(|error| format!("Read WAV #{index} sample: {error}"))? != 0 {
            non_zero_sample = true;
        }
    }
    let bytes = std::fs::metadata(path)
        .map_err(|error| format!("Read WAV #{index} metadata: {error}"))?
        .len();
    let duration_ms = (u64::from(samples) * 1000) / u64::from(spec.sample_rate.max(1));
    if spec.channels != 1
        || spec.sample_rate != 24_000
        || spec.bits_per_sample != 16
        || spec.sample_format != hound::SampleFormat::Int
        || samples == 0
        || duration_ms < 50
        || !non_zero_sample
    {
        return Err(format!(
            "WAV #{index} failed structure or duration validation"
        ));
    }
    if metrics.sample_rate != spec.sample_rate || metrics.samples != samples as usize {
        return Err(format!("WAV #{index} disagrees with synthesis metrics"));
    }
    if bytes < 44 + u64::from(samples) * 2 {
        return Err(format!(
            "WAV #{index} is shorter than its declared PCM payload"
        ));
    }
    Ok((bytes, duration_ms))
}

fn verify_isolation(result_path: &Path) -> Result<(), String> {
    let root = std::env::var_os("UNIFIA_VOICE_QUALIFICATION_ROOT")
        .map(PathBuf::from)
        .ok_or("UNIFIA_VOICE_QUALIFICATION_ROOT is required")?;
    let root = root
        .canonicalize()
        .map_err(|error| format!("Resolve isolated qualification root: {error}"))?;
    let result_parent = result_path
        .parent()
        .ok_or("Qualification result path must have a parent directory")?
        .canonicalize()
        .map_err(|error| format!("Resolve qualification report directory: {error}"))?;
    if !result_parent.starts_with(&root) {
        return Err("Qualification report path escapes isolated root".into());
    }
    for (name, variable) in [
        ("app data", "UNIFIA_VOICE_QUALIFICATION_DATA_DIR"),
        ("cache", "UNIFIA_VOICE_QUALIFICATION_CACHE_DIR"),
        ("logs", "UNIFIA_VOICE_QUALIFICATION_LOG_DIR"),
    ] {
        let path = std::env::var_os(variable)
            .map(PathBuf::from)
            .ok_or_else(|| format!("{variable} is required"))?
            .canonicalize()
            .map_err(|error| format!("Resolve isolated {name} path: {error}"))?;
        if !path.starts_with(&root) {
            return Err(format!("Resolved {name} path escapes isolated root"));
        }
    }
    Ok(())
}

fn require_new_worker(previous: u32, current: u32) -> Result<(), String> {
    if previous == current {
        Err("Voice recovery reused the crashed worker PID".into())
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recovery_requires_a_distinct_process_id() {
        assert!(require_new_worker(10, 11).is_ok());
        assert!(require_new_worker(10, 10).is_err());
    }

    #[test]
    fn report_uses_versioned_machine_readable_schema() {
        let report = QualificationReport {
            schema_version: 1,
            status: "fail",
            packaged: true,
            provider: "pocket",
            language: "en",
            started_at_unix_ms: 1,
            ..QualificationReport::default()
        };
        let value = serde_json::to_value(report).expect("report should serialize");
        assert_eq!(value["schema_version"], 1);
        assert_eq!(value["packaged"], true);
        assert!(value["workers"].is_array());
        assert!(value["syntheses"].is_array());
    }

    #[test]
    fn wav_validation_checks_header_payload_and_reported_samples() {
        let path = std::env::temp_dir().join(format!(
            "unifia-voice-qualification-{}.wav",
            uuid::Uuid::new_v4()
        ));
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: 24_000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut writer = hound::WavWriter::create(&path, spec).expect("create fixture WAV");
        for _ in 0..2400 {
            writer.write_sample(64_i16).expect("write fixture sample");
        }
        writer.finalize().expect("finalize fixture WAV");
        let metrics = crate::voice_runtime::SynthesisMetrics {
            sample_rate: 24_000,
            samples: 2400,
            duration_ms: 100,
            first_audio_ms: 20,
            generation_ms: 100,
            wav_finalize_ms: 1,
            failure_detection_ms: None,
            restart_ms: None,
            retry_ms: None,
        };
        let result = validate_wav(&path, 1, &metrics).expect("valid fixture WAV");
        assert!(result.0 >= 44 + 2400 * 2);
        assert_eq!(result.1, 100);
        std::fs::remove_file(path).expect("remove fixture WAV");
    }
}

fn write_report(path: &Path, report: &QualificationReport) -> Result<(), String> {
    let serialized = serde_json::to_vec_pretty(report).map_err(|error| error.to_string())?;
    std::fs::write(path, serialized).map_err(|error| format!("Write qualification report: {error}"))
}

fn unix_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}
