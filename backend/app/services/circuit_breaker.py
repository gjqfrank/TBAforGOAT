"""Circuit breaker for external API calls.

When an upstream service fails repeatedly, the circuit opens and
subsequent calls fail fast instead of piling up on a dead endpoint.
After a cooldown period the circuit half-opens to let a single test
request through — if it succeeds the circuit closes again.
"""
from __future__ import annotations

import asyncio
import logging
import time
from enum import Enum
from typing import Any, Callable, Coroutine, Optional

log = logging.getLogger(__name__)


class State(Enum):
    CLOSED = "closed"        # normal — requests flow through
    OPEN = "open"            # tripped — requests fail fast
    HALF_OPEN = "half_open"  # cooldown elapsed — allow one probe


class CircuitBreaker:
    """Per-service circuit breaker with configurable thresholds.

    Failures are counted within a sliding *window* seconds so that old
    failures from brief blips don't keep the circuit open indefinitely.
    """

    def __init__(
        self,
        name: str,
        failure_threshold: int = 5,
        recovery_timeout: float = 30.0,
        half_open_max: int = 1,
        window: float = 60.0,
    ) -> None:
        self.name = name
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.half_open_max = half_open_max
        self.window = window

        self._state = State.CLOSED
        self._failure_times: list[float] = []
        self._last_failure_time = 0.0
        self._half_open_count = 0
        self._lock = asyncio.Lock()

    @property
    def state(self) -> State:
        if self._state == State.OPEN:
            if time.monotonic() - self._last_failure_time >= self.recovery_timeout:
                return State.HALF_OPEN
        return self._state

    async def call(
        self,
        coro_factory: Callable[[], Coroutine[Any, Any, Any]],
        is_failure: Optional[Callable[[Exception], bool]] = None,
    ) -> Any:
        """Execute *coro_factory()* through the breaker.

        Raises ``CircuitOpenError`` when the circuit is open.

        *is_failure* optionally classifies exceptions: return True to count the
        exception toward the threshold, False to let it propagate without
        tripping the breaker (e.g. 404 Not Found is not a service outage).
        When omitted every exception counts as a failure.
        """
        current = self.state

        if current == State.OPEN:
            raise CircuitOpenError(self.name)

        if current == State.HALF_OPEN:
            async with self._lock:
                if self._half_open_count >= self.half_open_max:
                    raise CircuitOpenError(self.name)
                self._half_open_count += 1

        try:
            result = await coro_factory()
        except Exception as exc:
            if is_failure is None or is_failure(exc):
                await self._record_failure()
            raise
        else:
            await self._record_success()
            return result

    async def _record_failure(self) -> None:
        async with self._lock:
            now = time.monotonic()
            self._failure_times.append(now)
            self._last_failure_time = now
            cutoff = now - self.window
            self._failure_times = [t for t in self._failure_times if t >= cutoff]
            if len(self._failure_times) >= self.failure_threshold:
                if self._state != State.OPEN:
                    log.warning(
                        "Circuit breaker [%s] OPEN after %d failures in %.0fs window",
                        self.name, len(self._failure_times), self.window,
                    )
                self._state = State.OPEN

    async def _record_success(self) -> None:
        async with self._lock:
            if self._state in (State.HALF_OPEN, State.OPEN):
                log.info("Circuit breaker [%s] CLOSED (recovered)", self.name)
            self._state = State.CLOSED
            self._failure_times = []
            self._half_open_count = 0

    def reset(self) -> None:
        """Manually close the breaker (e.g. after a cache clear)."""
        self._state = State.CLOSED
        self._failure_times = []
        self._half_open_count = 0


class CircuitOpenError(Exception):
    """Raised when the circuit breaker is open for a given service."""

    def __init__(self, service_name: str) -> None:
        self.service_name = service_name
        super().__init__(
            f"Service '{service_name}' is temporarily unavailable — "
            "too many recent failures. Please try again in a few seconds."
        )


# ── Shared breaker instances ────────────────────────────────
_breakers: dict[str, CircuitBreaker] = {}


def get_breaker(name: str, **kwargs: Any) -> CircuitBreaker:
    if name not in _breakers:
        _breakers[name] = CircuitBreaker(name, **kwargs)
    return _breakers[name]


# Pre-configured breakers for each upstream.
# Thresholds are set to 10 because concurrent asyncio.gather calls (6–8 parallel
# TBA requests per endpoint) can burst through 5 failures in milliseconds during
# a single transient hiccup, opening the breaker prematurely.
tba_breaker = get_breaker("The Blue Alliance", failure_threshold=10, recovery_timeout=30, window=60)
frc_breaker = get_breaker("FRC Events API", failure_threshold=10, recovery_timeout=60, window=60)
ftc_breaker = get_breaker("FTC Events API", failure_threshold=5, recovery_timeout=30, window=60)
statbotics_breaker = get_breaker("Statbotics", failure_threshold=10, recovery_timeout=60, window=60)
gatool_breaker = get_breaker("GATool", failure_threshold=5, recovery_timeout=60, window=60)
