"""VoiceAgentBridge: hand voice turns to the existing Unifia session.

The bridge uses the same server API as the UI composer — ``POST
/session/:id/prompt_async`` and the ``/event`` stream — so a voice turn goes
through the canonical session, provider router, agent loop, tools and
permission gate. It never calls a model, a tool or a permission itself.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any, Literal

import aiohttp

from .turns import VoiceTurn

log = logging.getLogger("unifia.voice.bridge")

EventType = Literal[
    "text-delta", "tool-start", "tool-end", "permission-required", "question", "working", "done", "error"
]


@dataclass(frozen=True)
class VoiceAgentEvent:
    type: EventType
    text: str = ""
    name: str = ""
    id: str = ""


@dataclass
class ServerEndpoint:
    url: str
    username: str
    password: str

    def auth_header(self) -> str:
        token = base64.b64encode(f"{self.username}:{self.password}".encode()).decode("ascii")
        return f"Basic {token}"


@dataclass
class LiveBinding:
    """What the Unifia server bound to one Live room (resolved by opaque id)."""

    id: str
    directory: str
    session_id: str | None = None
    agent: str | None = None
    model: dict[str, str] | None = None
    variant: str | None = None
    language: str = "auto"
    locale: str | None = None

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> "LiveBinding":
        model = data.get("model")
        return cls(
            id=str(data["id"]),
            directory=str(data["directory"]),
            session_id=data.get("sessionID") or None,
            agent=data.get("agent") or None,
            model=model if isinstance(model, dict) else None,
            variant=data.get("variant") or None,
            language=str(data.get("language") or "auto"),
            locale=data.get("locale") or None,
        )


class BridgeError(RuntimeError):
    pass


@dataclass
class _TurnTracker:
    """Maps raw bus events of one session to VoiceAgentEvents for one turn."""

    session_id: str
    user_message_id: str
    assistant_ids: set[str] = field(default_factory=set)
    text_parts: dict[str, int] = field(default_factory=dict)  # part id -> chars already yielded
    pending_deltas: dict[str, list[str]] = field(default_factory=dict)
    tools_started: set[str] = field(default_factory=set)
    tools_ended: set[str] = field(default_factory=set)
    busy_seen: bool = False
    finished: bool = False

    def handle(self, event: dict[str, Any]) -> list[VoiceAgentEvent]:
        kind = event.get("type")
        props = event.get("properties") or {}
        if not isinstance(props, dict):
            return []
        if props.get("sessionID") not in (None, self.session_id) and kind != "message.updated":
            return []
        if kind == "message.updated":
            info = props.get("info") or {}
            if info.get("sessionID") != self.session_id:
                return []
            if info.get("role") == "assistant" and info.get("parentID") == self.user_message_id:
                self.assistant_ids.add(str(info.get("id")))
                error = info.get("error")
                if error:
                    name = error.get("name") if isinstance(error, dict) else None
                    return [VoiceAgentEvent("error", text=str(name or "assistant error"))]
            return []
        if kind == "message.part.updated":
            part = props.get("part") or {}
            if part.get("messageID") not in self.assistant_ids:
                return []
            part_id = str(part.get("id"))
            if part.get("type") == "text":
                out: list[VoiceAgentEvent] = []
                already = self.text_parts.setdefault(part_id, 0)
                for delta in self.pending_deltas.pop(part_id, []):
                    out.append(VoiceAgentEvent("text-delta", text=delta))
                    already += len(delta)
                text = str(part.get("text") or "")
                if len(text) > already:
                    out.append(VoiceAgentEvent("text-delta", text=text[already:]))
                    already = len(text)
                self.text_parts[part_id] = already
                return out
            if part.get("type") == "tool":
                call = str(part.get("callID") or part_id)
                name = str(part.get("tool") or "tool")
                status = (part.get("state") or {}).get("status")
                if status in ("running", "pending") and call not in self.tools_started:
                    self.tools_started.add(call)
                    return [VoiceAgentEvent("tool-start", name=name, id=call)]
                if status in ("completed", "error") and call not in self.tools_ended:
                    self.tools_ended.add(call)
                    started = [] if call in self.tools_started else [VoiceAgentEvent("tool-start", name=name, id=call)]
                    self.tools_started.add(call)
                    return [*started, VoiceAgentEvent("tool-end", name=name, id=call)]
            return []
        if kind == "message.part.delta":
            if props.get("messageID") not in self.assistant_ids or props.get("field") != "text":
                return []
            part_id = str(props.get("partID"))
            delta = str(props.get("delta") or "")
            if part_id not in self.text_parts:
                # Could be a reasoning part; wait until part.updated names its type.
                self.pending_deltas.setdefault(part_id, []).append(delta)
                return []
            self.text_parts[part_id] += len(delta)
            return [VoiceAgentEvent("text-delta", text=delta)]
        if kind == "permission.asked":
            return [VoiceAgentEvent("permission-required", id=str(props.get("id") or ""))]
        if kind == "question.asked":
            return [VoiceAgentEvent("question", id=str(props.get("id") or ""))]
        if kind == "session.error":
            error = props.get("error") or {}
            name = error.get("name") if isinstance(error, dict) else None
            return [VoiceAgentEvent("error", text=str(name or "session error"))]
        if kind == "session.status":
            status = (props.get("status") or {}).get("type")
            if status in ("busy", "retry"):
                self.busy_seen = True
                return []
            if status == "idle" and (self.busy_seen or self.assistant_ids):
                self.finished = True
                return [VoiceAgentEvent("done")]
            return []
        if kind == "session.idle" and (self.busy_seen or self.assistant_ids):
            self.finished = True
            return [VoiceAgentEvent("done")]
        return []


class VoiceAgentBridge:
    """One bridge per Live room; serializes session creation, shares HTTP."""

    def __init__(self, endpoint: ServerEndpoint, binding: LiveBinding, http: aiohttp.ClientSession) -> None:
        self.endpoint = endpoint
        self.binding = binding
        self.http = http
        self._session_lock = asyncio.Lock()

    def _headers(self) -> dict[str, str]:
        return {"Authorization": self.endpoint.auth_header(), "Accept": "application/json"}

    def _params(self) -> dict[str, str]:
        return {"directory": self.binding.directory}

    async def _request(
        self, method: str, path: str, body: Any = None, query: dict[str, str] | None = None
    ) -> Any:
        params = self._params()
        if query:
            params.update(query)
        async with self.http.request(
            method,
            f"{self.endpoint.url}{path}",
            params=params,
            json=body,
            headers=self._headers(),
            timeout=aiohttp.ClientTimeout(total=30),
        ) as response:
            if response.status >= 400:
                detail = (await response.text())[:300]
                raise BridgeError(f"{method} {path} -> HTTP {response.status}: {detail}")
            if response.status == 204:
                return None
            text = await response.text()
            return json.loads(text) if text else None

    async def probe(self) -> None:
        """Verify the authenticated Unifia session bridge without creating state."""
        await self._request("GET", "/session", query={"limit": "1"})

    async def probe_selected_model(self) -> None:
        """Check that an explicit selection is configured, without generating a turn."""
        model = self.binding.model
        if model is None:
            return
        data = await self._request("GET", "/provider")
        if not isinstance(data, dict):
            raise BridgeError("provider catalog response is invalid")
        connected = data.get("connected")
        providers = data.get("all")
        if not isinstance(connected, list) or not isinstance(providers, list):
            raise BridgeError("provider catalog response is incomplete")
        provider_id = model.get("providerID")
        model_id = model.get("modelID")
        selected = next(
            (provider for provider in providers if isinstance(provider, dict) and provider.get("id") == provider_id),
            None,
        )
        models = selected.get("models") if selected else None
        if provider_id not in connected or not isinstance(models, dict) or model_id not in models:
            raise BridgeError("selected model is not configured")

    async def ensure_session(self) -> str:
        """Return the bound session, creating it canonically on the first turn."""
        async with self._session_lock:
            if self.binding.session_id:
                return self.binding.session_id
            created = await self._request("POST", "/session", {})
            session_id = str(created["id"])
            await self._request("POST", f"/voice/live/bindings/{self.binding.id}/session", {"sessionID": session_id})
            self.binding.session_id = session_id
            log.info("voice turn created session", extra={"binding": self.binding.id})
            return session_id

    async def message_exists(self, session_id: str, message_id: str) -> bool:
        try:
            await self._request("GET", f"/session/{session_id}/message/{message_id}")
            return True
        except BridgeError as error:
            if "HTTP 404" in str(error):
                return False
            raise

    async def submit(self, turn: VoiceTurn, tracker: "_TurnTracker | None" = None) -> AsyncIterator[VoiceAgentEvent]:
        """Submit ``turn`` (once) and stream the agent's response events for it.

        The prompt is posted only if its message id is not already stored, so
        re-listening to a turn after a drop never submits it twice. Closing the
        iterator stops listening only; the Unifia run continues.
        """
        session_id = turn.session_id or await self.ensure_session()
        if tracker is None:
            tracker = _TurnTracker(session_id=session_id, user_message_id=turn.message_id)
        async with self.http.get(
            f"{self.endpoint.url}/event",
            params=self._params(),
            headers={"Authorization": self.endpoint.auth_header(), "Accept": "text/event-stream"},
            timeout=aiohttp.ClientTimeout(total=None, sock_connect=10, sock_read=60),
        ) as stream:
            if stream.status >= 400:
                raise BridgeError(f"event stream -> HTTP {stream.status}")
            events = _sse_events(stream.content)
            first = await anext(events, None)
            if first is None or first.get("type") != "server.connected":
                raise BridgeError("event stream did not confirm the subscription")
            if not await self.message_exists(session_id, turn.message_id):
                body: dict[str, Any] = {
                    "messageID": turn.message_id,
                    "parts": [{"type": "text", "text": turn.transcript}],
                }
                if self.binding.agent:
                    body["agent"] = self.binding.agent
                if self.binding.model:
                    body["model"] = self.binding.model
                if self.binding.variant:
                    body["variant"] = self.binding.variant
                await self._request("POST", f"/session/{session_id}/prompt_async", body)
            async for event in events:
                for mapped in tracker.handle(event):
                    yield mapped
                if tracker.finished:
                    return

    async def final_text(self, session_id: str, user_message_id: str) -> str:
        """Last text answer of the assistant message(s) replying to a turn."""
        messages = await self._request("GET", f"/session/{session_id}/message")
        texts: list[str] = []
        for message in messages or []:
            info = message.get("info") or {}
            if info.get("role") != "assistant" or info.get("parentID") != user_message_id:
                continue
            parts = [p for p in message.get("parts") or [] if p.get("type") == "text" and not p.get("synthetic")]
            if parts:
                texts = [str(p.get("text") or "") for p in parts]
        return "\n\n".join(t for t in texts if t.strip())


async def _sse_events(content: aiohttp.StreamReader) -> AsyncIterator[dict[str, Any]]:
    data: list[str] = []
    async for raw in content:
        line = raw.decode("utf-8", errors="replace").rstrip("\r\n")
        if not line:
            if data:
                try:
                    parsed = json.loads("\n".join(data))
                    if isinstance(parsed, dict):
                        yield parsed
                except json.JSONDecodeError:
                    log.warning("dropped malformed server event")
                data = []
            continue
        if line.startswith("data:"):
            data.append(line[5:].lstrip())
