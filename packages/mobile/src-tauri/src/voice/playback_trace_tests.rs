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
