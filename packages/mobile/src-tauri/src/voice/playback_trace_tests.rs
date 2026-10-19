// SPDX-License-Identifier: MIT
use super::*;

#[test]
fn missing_opt_in_never_creates_a_recording_directory() {
    let root = std::env::temp_dir().join(format!("voice-trace-disabled-{}", std::process::id()));
    assert!(PlaybackTrace::from_marker(root.clone())
        .expect("disabled")
        .is_none());
    assert!(!root.exists());
}

#[test]
fn opt_in_is_consumed_once_without_recording_until_speech() {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("voice-trace-opt-in-{stamp}"));
    fs::create_dir(&root).expect("test root");
    fs::write(root.join("voice-live-trace.enabled"), b"").expect("marker");
    let trace = PlaybackTrace::from_marker(root.clone())
        .expect("opt in")
        .expect("trace");
    assert!(!root.join("voice-live-trace.enabled").exists());
    assert!(PlaybackTrace::from_marker(root.clone())
        .expect("second check")
        .is_none());
    drop(trace);
    let sessions = root.join("voice-traces");
    let session = fs::read_dir(&sessions)
        .expect("sessions")
        .next()
        .expect("one session")
        .expect("entry")
        .path();
    let manifest = fs::read_to_string(session.join("trace.tsv")).expect("manifest");
    assert!(!manifest.contains("stream-begin"));
    fs::remove_file(session.join("trace.tsv")).expect("manifest cleanup");
    fs::remove_dir(session).expect("session cleanup");
    fs::remove_dir(sessions).expect("sessions cleanup");
    fs::remove_dir(root).expect("root cleanup");
}

#[test]
fn metric_budget_is_bounded_even_without_audio() {
    let budget = Budget::default();
    for _ in 0..MAX_EVENTS {
        assert!(budget.reserve(0));
    }
    assert!(!budget.reserve(0));
    assert_eq!(budget.events.load(Ordering::Relaxed), MAX_EVENTS);
}

#[test]
fn expiration_stops_writes_without_sleeping_or_blocking() {
    let (sender, receiver) = mpsc::sync_channel(1);
    let origin = OnceLock::new();
    origin
        .set(Instant::now() - Duration::from_secs(MAX_SECONDS + 1))
        .expect("origin");
    let trace = PlaybackTrace {
        sender: Some(sender),
        worker: None,
        budget: Arc::new(Budget::default()),
        origin,
    };
    trace.metric("must-not-write", 1);
    assert!(trace.expired());
    assert!(trace.budget.limited.load(Ordering::Relaxed));
    assert!(matches!(
        receiver.try_recv(),
        Err(mpsc::TryRecvError::Empty)
    ));
}

#[test]
fn budget_rejects_overflow_without_wrapping() {
    let budget = Budget::default();
    assert!(budget.reserve(MAX_BYTES));
    assert!(!budget.reserve(1));
    assert!(!budget.reserve(usize::MAX));
    assert_eq!(budget.bytes.load(Ordering::Relaxed), MAX_BYTES);
    assert_eq!(budget.dropped.load(Ordering::Relaxed), 2);
}

#[test]
fn full_queue_drops_diagnostics_without_blocking_audio() {
    let (sender, receiver) = mpsc::sync_channel(1);
    let trace = PlaybackTrace {
        sender: Some(sender),
        worker: None,
        budget: Arc::new(Budget::default()),
        origin: OnceLock::new(),
    };
    trace.begin(1);
    trace.samples(Stage::Accepted, &[123, -123]);
    assert_eq!(trace.budget.dropped.load(Ordering::Relaxed), 1);
    assert_eq!(
        receiver.try_recv().expect("first event").name,
        "stream-begin"
    );
}

#[test]
fn storage_failure_ends_worker_without_failing_the_audio_producer() {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("voice-trace-storage-{stamp}"));
    let mut trace = PlaybackTrace::start(root.clone()).expect("trace");
    let blocked = root.join("accepted-48000.pcm");
    fs::create_dir(&blocked).expect("block PCM file");
    trace.begin(1);
    trace.samples(Stage::Accepted, &[1, 2]);
    drop(trace.sender.take());
    let result = trace
        .worker
        .take()
        .expect("worker")
        .join()
        .expect("no panic");
    assert!(result.is_err());
    let manifest = fs::read_to_string(root.join("trace.tsv")).expect("manifest");
    assert!(!manifest.contains("summary"));
    fs::remove_dir(blocked).expect("block cleanup");
    fs::remove_file(root.join("trace.tsv")).expect("manifest cleanup");
    fs::remove_dir(root).expect("root cleanup");
}

#[test]
fn trace_preserves_same_pcm_and_declares_no_microphone_capture() {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("voice-trace-test-{stamp}"));
    {
        let trace = PlaybackTrace::start(root.clone()).expect("trace");
        trace.metric("ignored-before-first-speech", 1);
        trace.begin(7);
        trace.bytes(Stage::Pocket(7), &[1, 0, 2, 0]);
        trace.samples(Stage::Accepted, &[1, -2]);
        trace.samples(Stage::Rendered, &[1, -2, 0, 0]);
        trace.metric("native-trace-dropped-samples", 0);
    }
    assert_eq!(
        fs::read(root.join("pocket-7-24000.pcm")).expect("raw"),
        [1, 0, 2, 0]
    );
    assert_eq!(
        fs::read(root.join("accepted-48000.pcm")).expect("accepted"),
        [1, 0, 254, 255]
    );
    assert_eq!(
        fs::read(root.join("rendered-48000.pcm")).expect("rendered"),
        [1, 0, 254, 255, 0, 0, 0, 0]
    );
    let manifest = fs::read_to_string(root.join("trace.tsv")).expect("manifest");
    assert!(manifest.contains("mic-recording=false"));
    assert!(manifest.contains("dropped-events\t0"));
    assert!(!manifest.contains("ignored-before-first-speech"));
    for name in [
        "pocket-7-24000.pcm",
        "accepted-48000.pcm",
        "rendered-48000.pcm",
        "trace.tsv",
    ] {
        fs::remove_file(root.join(name)).expect("test file cleanup");
    }
    fs::remove_dir(root).expect("test directory cleanup");
}
