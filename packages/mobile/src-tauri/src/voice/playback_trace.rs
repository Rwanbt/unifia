// SPDX-License-Identifier: MIT
//! Opt-in generated/output speech diagnostics. Never receives microphone PCM.

use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        mpsc::{self, SyncSender, TrySendError},
        Arc, OnceLock,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const MAX_BYTES: usize = 24 * 1024 * 1024;
const MAX_EVENTS: usize = 16_384;
const MAX_SECONDS: u64 = 90;
const CHUNK_BYTES: usize = 16_384;
const QUEUE_EVENTS: usize = 32;

#[derive(Clone, Copy)]
pub(super) enum Stage {
    Pocket(u64),
    Accepted,
    Rendered,
}

impl Stage {
    fn filename(self) -> String {
        match self {
            Self::Pocket(id) => format!("pocket-{id}-24000.pcm"),
            Self::Accepted => "accepted-48000.pcm".into(),
            Self::Rendered => "rendered-48000.pcm".into(),
        }
    }
}

struct Event {
    micros: u128,
    name: String,
    value: u64,
    pcm: Vec<u8>,
}

#[derive(Default)]
struct Budget {
    bytes: AtomicUsize,
    events: AtomicUsize,
    dropped: AtomicUsize,
    limited: AtomicBool,
}

impl Budget {
    fn increment(counter: &AtomicUsize, delta: usize, maximum: usize) -> bool {
        let mut current = counter.load(Ordering::Relaxed);
        loop {
            let Some(next) = current.checked_add(delta).filter(|next| *next <= maximum) else {
                return false;
            };
            // Keep compatibility with both the installed Android toolchain and
            // newer CI Rust, where fetch_update was renamed to try_update.
            match counter.compare_exchange_weak(current, next, Ordering::Relaxed, Ordering::Relaxed)
            {
                Ok(_) => return true,
                Err(actual) => current = actual,
            }
        }
    }

    fn reserve(&self, bytes: usize) -> bool {
        let allowed = Self::increment(&self.events, 1, MAX_EVENTS)
            && Self::increment(&self.bytes, bytes, MAX_BYTES);
        if !allowed {
            self.dropped.fetch_add(1, Ordering::Relaxed);
            self.limited.store(true, Ordering::Relaxed);
        }
        allowed
    }
}

pub(super) struct PlaybackTrace {
    sender: Option<SyncSender<Event>>,
    worker: Option<JoinHandle<io::Result<()>>>,
    budget: Arc<Budget>,
    origin: OnceLock<Instant>,
}

impl PlaybackTrace {
    /// A local marker is explicit opt-in; no capture is enabled in a normal APK.
    pub(super) fn from_marker(root: PathBuf) -> io::Result<Option<Arc<Self>>> {
        let marker = root.join("voice-live-trace.enabled");
        match fs::symlink_metadata(&marker) {
            Ok(metadata) if metadata.file_type().is_file() => {}
            Ok(_) => return Ok(None),
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error),
        }
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(io::Error::other)?
            .as_nanos();
        let trace = Self::start(
            root.join("voice-traces")
                .join(format!("{stamp}-{}", std::process::id())),
        )?;
        // One-shot opt-in: ordinary later Live sessions must not keep creating
        // speech recordings after this bounded diagnostic session finishes.
        fs::remove_file(marker)?;
        Ok(Some(Arc::new(trace)))
    }

    fn start(root: PathBuf) -> io::Result<Self> {
        fs::create_dir_all(&root)?;
        let mut manifest = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(root.join("trace.tsv"))?;
        writeln!(
            manifest,
            "voice-trace-v1\tpcm16le-mono\tmax-bytes={MAX_BYTES}\tmax-seconds={MAX_SECONDS}"
        )?;
        writeln!(
            manifest,
            "mic-recording=false\ttime-us\tstage-or-metric\tbytes-or-value"
        )?;
        let (sender, receiver) = mpsc::sync_channel::<Event>(QUEUE_EVENTS);
        let budget = Arc::new(Budget::default());
        let counters = Arc::clone(&budget);
        // The worker owns all file I/O. Neither the callback nor the native
        // inference lock waits for disk or a full diagnostics queue.
        let worker = thread::Builder::new()
            .name("voice-pcm-trace".into())
            .spawn(move || {
                for event in receiver {
                    if !event.pcm.is_empty() {
                        OpenOptions::new()
                            .append(true)
                            .create(true)
                            .open(root.join(&event.name))?
                            .write_all(&event.pcm)?;
                    }
                    writeln!(
                        manifest,
                        "{}\t{}\t{}",
                        event.micros, event.name, event.value
                    )?;
                }
                writeln!(
                    manifest,
                    "summary\tdropped-events\t{}",
                    counters.dropped.load(Ordering::Relaxed)
                )?;
                writeln!(
                    manifest,
                    "summary\tlimit-reached\t{}",
                    counters.limited.load(Ordering::Relaxed)
                )?;
                manifest.sync_all()
            })?;
        Ok(Self {
            sender: Some(sender),
            worker: Some(worker),
            budget,
            origin: OnceLock::new(),
        })
    }

    pub(super) fn begin(&self, id: u64) {
        self.origin.get_or_init(Instant::now);
        self.metric("stream-begin", id);
    }

    pub(super) fn expired(&self) -> bool {
        let expired = self
            .origin
            .get()
            .is_some_and(|origin| origin.elapsed() >= Duration::from_secs(MAX_SECONDS))
            || self.budget.bytes.load(Ordering::Relaxed) >= MAX_BYTES
            || self.budget.events.load(Ordering::Relaxed) >= MAX_EVENTS;
        if expired {
            self.budget.limited.store(true, Ordering::Relaxed);
        }
        expired
    }

    fn send(&self, name: String, value: u64, pcm: Vec<u8>) {
        let Some(origin) = self.origin.get() else {
            return;
        };
        if self.expired() {
            self.budget.limited.store(true, Ordering::Relaxed);
            return;
        }
        if !self.budget.reserve(pcm.len()) {
            return;
        }
        let event = Event {
            micros: origin.elapsed().as_micros(),
            name,
            value,
            pcm,
        };
        if let Some(sender) = &self.sender {
            match sender.try_send(event) {
                Ok(()) => {}
                Err(TrySendError::Full(_) | TrySendError::Disconnected(_)) => {
                    self.budget.dropped.fetch_add(1, Ordering::Relaxed);
                }
            }
        }
    }

    pub(super) fn metric(&self, name: &str, value: u64) {
        self.send(name.into(), value, Vec::new());
    }

    pub(super) fn bytes(&self, stage: Stage, pcm: &[u8]) {
        if self.expired() || self.origin.get().is_none() {
            return;
        }
        for chunk in pcm.chunks(CHUNK_BYTES) {
            self.send(stage.filename(), chunk.len() as u64, chunk.to_vec());
        }
    }

    pub(super) fn samples(&self, stage: Stage, pcm: &[i16]) {
        if self.expired() || self.origin.get().is_none() {
            return;
        }
        for chunk in pcm.chunks(CHUNK_BYTES / 2) {
            let bytes = chunk
                .iter()
                .flat_map(|sample| sample.to_le_bytes())
                .collect::<Vec<_>>();
            self.send(stage.filename(), bytes.len() as u64, bytes);
        }
    }
}

impl Drop for PlaybackTrace {
    fn drop(&mut self) {
        drop(self.sender.take());
        if let Some(worker) = self.worker.take() {
            match worker.join() {
                Ok(Ok(())) => {}
                Ok(Err(error)) => eprintln!("[voice] PCM trace write failed: {error}"),
                Err(error) => eprintln!("[voice] PCM trace worker failed: {error:?}"),
            }
        }
    }
}
