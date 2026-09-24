"""Voice turn identity and idempotent submission bookkeeping."""

from __future__ import annotations

import hashlib
import os
import secrets
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass

_BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
_id_lock = threading.Lock()
_last_ms = 0
_counter = 0


def ascending_id(prefix: str, now_ms: int | None = None) -> str:
    """Same layout as ``Identifier.ascending`` in the Unifia server.

    ``<prefix>_`` + 12 hex digits of (milliseconds * 4096 + counter) + 14 base62
    characters, so ids created here sort with ids created by the server.
    """
    global _last_ms, _counter
    with _id_lock:
        current = int(time.time() * 1000) if now_ms is None else now_ms
        if current != _last_ms:
            _last_ms = current
            _counter = 0
        _counter += 1
        value = (current * 0x1000 + _counter) & 0xFFFFFFFFFFFF
    random_part = "".join(_BASE62[b % 62] for b in os.urandom(14))
    return f"{prefix}_{value:012x}{random_part}"


@dataclass(frozen=True)
class VoiceTurn:
    id: str
    session_id: str | None
    device_id: str
    transcript: str
    language: str
    started_at: float
    ended_at: float
    message_id: str


def turn_id_for(room: str, participant: str, source_item_id: str) -> str:
    """Stable id for one finalized utterance.

    The LiveKit chat item id is unique per finalized user utterance within an
    agent session; hashing it with the room and participant keeps the id
    opaque (no transcript, no user name) and stable across LLM retries.
    """
    digest = hashlib.sha256(f"{room}\x00{participant}\x00{source_item_id}".encode()).hexdigest()
    return f"vt_{digest[:24]}"


class TurnLedger:
    """Remembers submitted turns so a retry or reconnect never submits twice.

    Entries are kept for the lifetime of the agent job, bounded in number.
    Eviction is safe: turn ids are derived from LiveKit item ids that are never
    reused within a job, and the ledger size far exceeds the number of turns a
    single conversation produces before its job ends.
    """

    def __init__(self, capacity: int = 4096) -> None:
        self._capacity = capacity
        self._turns: OrderedDict[str, VoiceTurn] = OrderedDict()
        self._lock = threading.Lock()

    def claim(self, turn: VoiceTurn) -> VoiceTurn | None:
        """Register ``turn``; return the earlier record if it was already claimed."""
        with self._lock:
            existing = self._turns.get(turn.id)
            if existing is not None:
                return existing
            self._turns[turn.id] = turn
            while len(self._turns) > self._capacity:
                self._turns.popitem(last=False)
            return None

    def get(self, turn_id: str) -> VoiceTurn | None:
        with self._lock:
            return self._turns.get(turn_id)

    def __len__(self) -> int:
        with self._lock:
            return len(self._turns)


def device_id() -> str:
    return f"dev_{secrets.token_hex(8)}"
