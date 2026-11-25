"""Limits on AI searches, so one reader (or a script) can't run up the model bill.

Three sliding windows, each set by an env var (0 turns that one off):
- AI_LIMIT_PER_MINUTE (default 10) per reader: stops scripts and accidental loops.
  A person typing questions rarely gets near it.
- AI_LIMIT_PER_DAY (default 100) per reader, over the last 24 hours.
- AI_LIMIT_GLOBAL_PER_DAY (default 500) for everyone together: a hard cap on what the
  service can spend in a day, however many accounts sign up.

Readers are counted by account (the backend's user id), not by session or IP, so
logging in again doesn't reset anything. Only searches that reach the model count.

The counters live in this process's memory: one AI service instance (as in Compose),
and they reset when it restarts. Several instances would need a shared store (Redis).
"""

import math
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass, field

MINUTE = 60.0
DAY = 24 * 60 * 60.0

TOO_FAST = "You're asking too fast. Try again in {wait}."
DAILY_LIMIT = (
    "You've used your {limit} AI searches for today. Try again in {wait}, or use the filters."
)
GLOBAL_LIMIT = (
    "AI search has reached its daily limit for everyone. Try again in {wait}, or use the filters."
)


class LimitExceeded(Exception):
    def __init__(self, message: str, retry_after: int) -> None:
        super().__init__(message)
        self.message = message
        self.retry_after = retry_after


def describe_wait(seconds: int) -> str:
    """Rounded up, in the largest sensible unit: "45 seconds", "2 minutes", "3 hours"."""
    if seconds < 60:
        return f"{seconds} second{'s' if seconds != 1 else ''}"
    if seconds < 3600:
        minutes = math.ceil(seconds / 60)
        return f"{minutes} minute{'s' if minutes != 1 else ''}"
    hours = math.ceil(seconds / 3600)
    return f"{hours} hour{'s' if hours != 1 else ''}"


@dataclass
class SearchLimiter:
    per_minute: int
    per_day: int
    global_per_day: int
    clock: Callable[[], float] = time.monotonic
    _readers: dict[int, deque[float]] = field(default_factory=dict, init=False)
    _everyone: deque[float] = field(default_factory=deque, init=False)

    def check_and_record(self, reader_id: int) -> None:
        """Count one search for this reader, or raise LimitExceeded without counting it.

        There's no await in here, so on the event loop the check and the record happen
        together: two simultaneous requests can't both slip under a limit."""
        now = self.clock()
        mine = self._readers.setdefault(reader_id, deque())
        _forget_before(mine, now - DAY)
        _forget_before(self._everyone, now - DAY)

        if self.per_minute:
            last_minute = [t for t in mine if t > now - MINUTE]
            if len(last_minute) >= self.per_minute:
                wait = _seconds_until(last_minute[-self.per_minute] + MINUTE, now)
                raise LimitExceeded(TOO_FAST.format(wait=describe_wait(wait)), wait)
        if self.per_day and len(mine) >= self.per_day:
            wait = _seconds_until(mine[-self.per_day] + DAY, now)
            message = DAILY_LIMIT.format(limit=self.per_day, wait=describe_wait(wait))
            raise LimitExceeded(message, wait)
        if self.global_per_day and len(self._everyone) >= self.global_per_day:
            wait = _seconds_until(self._everyone[-self.global_per_day] + DAY, now)
            raise LimitExceeded(GLOBAL_LIMIT.format(wait=describe_wait(wait)), wait)

        mine.append(now)
        self._everyone.append(now)


def _forget_before(times: deque[float], cutoff: float) -> None:
    while times and times[0] <= cutoff:
        times.popleft()


def _seconds_until(moment: float, now: float) -> int:
    return max(1, math.ceil(moment - now))
