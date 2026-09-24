# Voice capture ownership

`AudioCaptureCoordinator` grants a single microphone lease per renderer.
Dictation and voice-clone recording cannot start while another of those owners
holds the mic. Live has higher priority and stops either owner before acquiring
its lease. A stale asynchronous `getUserMedia()` result checks its lease and
immediately stops its tracks when ownership has already changed.

Desktop and mobile dictation keep the existing journey: record, stop, transcribe
with Parakeet, and insert text into the existing prompt. Preemption by Live or
runtime cleanup discards the partial recording; an explicit dictation stop
transcribes it. Permission failures emit `speech-ended` with `denied` or
`error`, which resets the microphone control and shows its translated message.
The route still decodes WebM, resamples to 16 kHz, encodes WAV/Base64, and calls
Tauri. Desktop/mobile logs report byte counts and stage durations without logging
audio contents or transcript text.

Voice-clone recording also holds the mic lease. Preemption discards its partial
sample instead of saving an unintended clone. `AudioCaptureCoordinator` is
installed by each runtime's speech listener and can be requested synchronously
through `requestAudioCapture()` by later Live capture code.
