# SPDX-License-Identifier: MIT
"""G13 host convergence — narrow producer seam.

Replaces the ad-hoc ``_voice_event_sequence`` counter inside ``LiveConversation``
with the canonical Rust ``VoiceCore`` accessed through its stable C ABI
(``unifia_voice_core``). This file is the only Python side of the seam;
any other producer that emits canonical events must use this same wrapper so
the JSON envelope, generation fence and turn-cap invariants are enforced in
one place.

The wrapper mirrors the C API in ``packages/voice-core/src/ffi.rs``. The
``Session`` object owns the opaque handle; ``publish`` round-trips the same
``VoiceEventKind`` JSON shape that the TypeScript and Android JNI sides use.
"""
from __future__ import annotations

import ctypes
import json
import os
from ctypes import c_char_p, c_int, c_uint64, c_void_p
from pathlib import Path
from typing import Any


_LIBRARY_FILENAMES = (
    "unifia_voice_core.dll",
    "libunifia_voice_core.so",
    "libunifia_voice_core.dylib",
)


def _find_library() -> str:
    """Locate the platform-specific shared library produced by ``voice-core``.

    The host build emits ``unifia_voice_core.dll`` on Windows, ``libunifia_voice_core.so``
    on Linux, and ``libunifia_voice_core.dylib`` on macOS. The Android JNI builds
    the same surface as a static archive, so this loader is host-only and the
    Tauri/desktop Python worker is the only caller in v2.2.

    ``UNIFIA_VOICE_CORE_LIB`` wins over discovery: an explicit override that
    points nowhere is an error, not a reason to silently fall back to a
    different build than the caller asked for.
    """
    override = os.environ.get("UNIFIA_VOICE_CORE_LIB")
    if override:
        if Path(override).is_file():
            return override
        raise FileNotFoundError(
            f"UNIFIA_VOICE_CORE_LIB points at a missing file: {override}"
        )

    # The cdylib lands under the voice-core package, so walk up from this file
    # until a parent that owns `packages/voice-core/target/release` shows up.
    for parent in Path(__file__).resolve().parents:
        release_dir = parent / "packages" / "voice-core" / "target" / "release"
        for filename in _LIBRARY_FILENAMES:
            candidate = release_dir / filename
            if candidate.is_file():
                return str(candidate)

    raise FileNotFoundError(
        "voice-core cdylib not found; build it with `cargo build --release "
        "-p unifia-voice-core` or set UNIFIA_VOICE_CORE_LIB"
    )


def _bind() -> ctypes.CDLL:
    lib = ctypes.CDLL(_find_library())
    lib.unifia_voice_core_create.restype = c_void_p
    lib.unifia_voice_core_create.argtypes = [c_char_p]
    lib.unifia_voice_core_destroy.restype = None
    lib.unifia_voice_core_destroy.argtypes = [c_void_p]
    lib.unifia_voice_core_begin_turn.restype = c_int
    lib.unifia_voice_core_begin_turn.argtypes = [c_void_p, c_char_p]
    # WHY: `publish` hands back a Rust-owned `*mut c_char` that the caller must
    # release through `unifia_voice_core_string_free`. Declaring the restype as
    # `c_char_p` would have ctypes convert it to a Python `bytes` and then free
    # the interpreter's own buffer, which aborts with STATUS_HEAP_CORRUPTION.
    lib.unifia_voice_core_publish.restype = c_void_p
    lib.unifia_voice_core_publish.argtypes = [c_void_p, c_char_p, c_uint64, c_char_p]
    lib.unifia_voice_core_reconnect.restype = c_int
    lib.unifia_voice_core_reconnect.argtypes = [c_void_p]
    lib.unifia_voice_core_string_free.restype = None
    lib.unifia_voice_core_string_free.argtypes = [c_void_p]
    return lib


class VoiceCoreError(RuntimeError):
    """Raised when the canonical VoiceCore rejects a publish or session op."""


class VoiceCoreSession:
    """Opaque handle wrapper that owns its lifecycle.

    Use as a context manager so the handle is always destroyed even on
    exception paths. ``publish`` round-trips the canonical JSON envelope
    produced by the Rust core; ``payload`` is whatever the caller would
    otherwise have serialised by hand.
    """

    def __init__(self, session_id: str, *, library: ctypes.CDLL | None = None) -> None:
        if not session_id or not session_id.startswith("ses_"):
            raise ValueError(
                "session_id must start with `ses_`; the canonical validator rejects empty inputs"
            )
        self._lib = library or _bind()
        handle = self._lib.unifia_voice_core_create(session_id.encode("utf-8"))
        if not handle:
            raise VoiceCoreError(f"VoiceCore rejected session_id={session_id!r}")
        self._handle = handle

    def __enter__(self) -> "VoiceCoreSession":
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()

    def close(self) -> None:
        if self._handle:
            self._lib.unifia_voice_core_destroy(self._handle)
            self._handle = None  # type: ignore[assignment]

    def begin_turn(self, turn_id: str) -> None:
        rc = self._lib.unifia_voice_core_begin_turn(self._handle, turn_id.encode("utf-8"))
        if rc != 0:
            raise VoiceCoreError(f"begin_turn rejected turn_id={turn_id!r} (rc={rc})")

    def publish(self, turn_id: str | None, monotonic_timestamp_ms: int, event: dict[str, Any]) -> dict[str, Any]:
        """Publish one canonical event; returns the validated envelope."""
        kind = event.get("kind")
        if not kind:
            raise ValueError("event must include `kind`")
        payload = json.dumps(event, separators=(",", ":")).encode("utf-8")
        # WHY: the core tells "no turn" from a null pointer, not from an empty
        # string. Passing b"" is non-null, so the core looks up turn "" , finds
        # no fence, and refuses the event with `invalid_turn`.
        turn_bytes = turn_id.encode("utf-8") if turn_id is not None else None
        raw = self._lib.unifia_voice_core_publish(
            self._handle,
            turn_bytes,
            monotonic_timestamp_ms,
            payload,
        )
        if not raw:
            raise VoiceCoreError(f"VoiceCore rejected {kind!r}")
        try:
            envelope = json.loads(ctypes.string_at(raw).decode("utf-8"))
        finally:
            self._lib.unifia_voice_core_string_free(raw)
        # WHY: the C ABI serialises the outcome as an internally tagged enum, so
        # `ok` is the snake_case *string* "true"/"false", not a JSON boolean.
        if envelope.get("ok") != "true":
            raise VoiceCoreError(
                f"VoiceCore rejected {kind!r}: {envelope.get('error', envelope)}"
            )
        return envelope["event"]

    def reconnect(self) -> None:
        rc = self._lib.unifia_voice_core_reconnect(self._handle)
        if rc != 0:
            raise VoiceCoreError(f"reconnect failed (rc={rc})")
