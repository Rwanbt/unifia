"""Incremental segmentation of a streamed LLM answer into speakable units.

Segments end at linguistic boundaries (sentence end, paragraph, list item)
rather than at a fixed character count, so each synthesized unit carries a
complete prosodic phrase. Code fences, tables and long lists are collapsed
into one short marker segment each; the renderer turns markers into a spoken
reference to the conversation.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

SegmentKind = Literal["prose", "code", "table", "list_rest"]

FIRST_MIN_CHARS = 2
MERGE_BELOW_CHARS = 40
MAX_CHARS = 220
MAX_LIST_ITEMS = 5

_ABBREVIATIONS = frozenset(
    {
        "e.g", "i.e", "etc", "vs", "mr", "mrs", "ms", "dr", "st", "no", "fig", "approx", "cf",
        "p.ex", "env", "mme", "m", "sr", "sra", "dott", "sig", "z.b", "bzw", "usw", "ca", "nr",
    }
)
_FENCE = re.compile(r"^\s{0,3}(```|~~~)")
_LIST_ITEM = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s+\S")
_TABLE_ROW = re.compile(r"^\s*\|.*\|\s*$")
_CLAUSE_BREAK = re.compile(r"[,;:](?=\s)")


@dataclass(frozen=True)
class Segment:
    kind: SegmentKind
    text: str = ""
    count: int = 0


def _sentence_end(text: str, start: int = 0) -> int | None:
    """Index just after the first stable sentence boundary, if any."""
    for match in re.finditer(r"[.!?…]+[\"'»”)\]]*(?=\s)", text[start:]):
        end = start + match.end()
        before = text[start : start + match.start()]
        word = re.findall(r"[\w.]+$", before)
        token = word[0].lower().rstrip(".") if word else ""
        if match.group(0).startswith(".") and (token in _ABBREVIATIONS or (len(token) == 1 and token.isalpha())):
            continue
        # Decimal numbers never end a sentence ("3.5 GB" has no space after ".").
        return end
    return None


class SpeechSegmenter:
    """Feed text deltas with ``push``; call ``flush`` once the stream ends."""

    def __init__(self) -> None:
        self._line = ""  # current, still-growing line
        self._prose = ""  # completed prose not yet emitted
        self._in_fence = False
        self._fence_marker = ""
        self._code_reported = False
        self._table_reported = False
        self._list_items = 0
        self._emitted_any = False

    def push(self, delta: str) -> list[Segment]:
        out: list[Segment] = []
        self._line += delta
        while "\n" in self._line:
            line, self._line = self._line.split("\n", 1)
            out.extend(self._complete_line(line))
        if not self._in_fence and not self._line_may_be_block_start(self._line):
            out.extend(self._drain(partial=self._line))
        return out

    def flush(self) -> list[Segment]:
        out: list[Segment] = []
        if self._line:
            line, self._line = self._line, ""
            out.extend(self._complete_line(line))
        out.extend(self._close_list())
        out.extend(self._drain(final=True))
        self._in_fence = False
        return out

    # -- line level -------------------------------------------------------

    def _line_may_be_block_start(self, line: str) -> bool:
        stripped = line.lstrip()
        return stripped.startswith(("`", "~", "|")) or (stripped == "" and line != "")

    def _complete_line(self, line: str) -> list[Segment]:
        out: list[Segment] = []
        fence = _FENCE.match(line)
        if self._in_fence:
            if fence and fence.group(1) == self._fence_marker:
                self._in_fence = False
            return out
        if fence:
            out.extend(self._close_list())
            out.extend(self._drain(final=True))
            self._in_fence = True
            self._fence_marker = fence.group(1)
            if not self._code_reported:
                self._code_reported = True
                out.append(Segment("code"))
            return out
        if _TABLE_ROW.match(line):
            out.extend(self._close_list())
            out.extend(self._drain(final=True))
            if not self._table_reported:
                self._table_reported = True
                out.append(Segment("table"))
            return out
        if _LIST_ITEM.match(line):
            out.extend(self._drain(final=True))
            self._list_items += 1
            if self._list_items <= MAX_LIST_ITEMS:
                out.append(Segment("prose", line.strip()))
                self._emitted_any = True
            return out
        out.extend(self._close_list())
        if not line.strip():
            # Paragraph break: whatever prose is buffered is complete.
            out.extend(self._drain(final=True))
            return out
        self._prose += line + "\n"
        out.extend(self._drain())
        return out

    def _close_list(self) -> list[Segment]:
        hidden = self._list_items - MAX_LIST_ITEMS
        self._list_items = 0
        return [Segment("list_rest", count=hidden)] if hidden > 0 else []

    # -- sentence level ---------------------------------------------------

    def _drain(self, partial: str = "", final: bool = False) -> list[Segment]:
        out: list[Segment] = []
        text = self._prose + partial
        consumed = 0
        while True:
            remaining = text[consumed:]
            if not remaining.strip():
                break
            end = _sentence_end(remaining + (" " if final else ""))
            if end is not None:
                end = min(end, len(remaining))
                candidate = remaining[:end]
                minimum = FIRST_MIN_CHARS if not self._emitted_any else MERGE_BELOW_CHARS
                rest = remaining[end:]
                if len(candidate.strip()) < minimum and not final:
                    following = _sentence_end(rest)
                    if following is None:
                        break  # wait for the next sentence to merge with
                    end += following
                    candidate = remaining[:end]
                consumed += end
                out.append(Segment("prose", candidate.strip()))
                self._emitted_any = True
                continue
            if len(remaining) > MAX_CHARS:
                window = remaining[:MAX_CHARS]
                clauses = list(_CLAUSE_BREAK.finditer(window))
                cut = clauses[-1].end() if clauses else window.rfind(" ")
                if cut <= 0:
                    cut = MAX_CHARS
                consumed += cut
                out.append(Segment("prose", remaining[:cut].strip()))
                self._emitted_any = True
                continue
            if final:
                consumed = len(text)
                out.append(Segment("prose", remaining.strip()))
                self._emitted_any = True
            break
        # Only completed prose can be consumed; a partial line stays in _line.
        consumed_from_prose = min(consumed, len(self._prose))
        self._prose = self._prose[consumed_from_prose:]
        if consumed > consumed_from_prose:
            self._line = self._line[consumed - consumed_from_prose :]
        return [segment for segment in out if segment.text or segment.kind != "prose"]
