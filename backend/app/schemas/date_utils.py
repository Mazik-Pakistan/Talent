from __future__ import annotations

import re
from datetime import UTC, date, datetime, timedelta
from typing import Any

_WEEKDAY_INDEX = {
    "monday": 0,
    "tuesday": 1,
    "wednesday": 2,
    "thursday": 3,
    "friday": 4,
    "saturday": 5,
    "sunday": 6,
}


def parse_natural_date(value: Any) -> date | None:
    """Parse common relative date phrases into a concrete date."""
    if value is None or value == "":
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value

    raw = " ".join(str(value).strip().lower().replace("_", " ").split())
    if not raw:
        return None

    today = datetime.now(UTC).date()

    if raw in {"today", "tod"}:
        return today
    if raw in {"tomorrow", "tmr", "tmrw"}:
        return today + timedelta(days=1)

    iso_candidate = raw[:10]
    try:
        return date.fromisoformat(iso_candidate)
    except ValueError:
        pass

    match = re.fullmatch(r"in (\d+) days?", raw)
    if match:
        return today + timedelta(days=int(match.group(1)))

    match = re.fullmatch(r"next ([a-z]+)", raw)
    if match:
        weekday = _WEEKDAY_INDEX.get(match.group(1))
        if weekday is not None:
            days_ahead = (weekday - today.weekday() + 7) % 7 or 7
            return today + timedelta(days=days_ahead)

    match = re.fullmatch(r"(?:on )?([a-z]+)", raw)
    if match:
        weekday = _WEEKDAY_INDEX.get(match.group(1))
        if weekday is not None:
            days_ahead = (weekday - today.weekday() + 7) % 7
            return today + timedelta(days=days_ahead or 7)

    return None
