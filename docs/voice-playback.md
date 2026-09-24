# Voice playback

Manual read-aloud and automatic assistant playback use the `tts-toggle` and
`tts-autoplay` window events. Desktop synthesis goes through `TtsRouter`; web
playback uses the browser speech engine. A completed assistant response emits
one autoplay request only when its final text part finishes. The runtime checks
the persisted autoplay preference before synthesizing.

Each renderer's `AudioPlaybackCoordinator` grants one playback lease at a time, ordered as
`live > manual > autoplay`. A higher-priority lease stops the current owner;
lower-priority autoplay is declined while manual or Live audio owns playback.
Live owners announce `tts-live-start` with a unique session id and synchronous
stop callback, then release that same id with `tts-live-ended`.

Settings voice-clone previews dispatch through the manual playback event, so
they share provider routing, cancellation, and playback ownership. Piper remains
the fallback behind `TtsRouter`; its process and model boundary are documented
in [voice-piper.md](voice-piper.md).

Mobile Live assistant audio is streamed from the paired desktop Voice Host over
LiveKit. Manual mobile read-aloud is still unavailable: the mobile hook reports
"Voice Host unavailable" and no authenticated manual synthesis route exists.
The desktop and web playback paths do not qualify mobile manual playback.
