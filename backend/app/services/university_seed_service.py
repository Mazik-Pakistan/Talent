"""
University seed service — imports the Kaggle dataset
  anshdwvdi/list-of-all-universities-in-the-world  (list_of_univs.csv)
into the `universities` MongoDB collection.

Idempotent: collection is checked first; if already populated the import is
skipped entirely so startup cost on subsequent runs is negligible (~1 ms).
Uses bulk_write for the initial import (single round-trip, very fast).
"""

import ast
import csv
import logging
import re
import unicodedata
from pathlib import Path

from pymongo import UpdateOne
from pymongo.errors import BulkWriteError

from app.core.database import database

logger = logging.getLogger(__name__)

_col = database.universities

# Default path written by kagglehub.dataset_download()
_DEFAULT_KAGGLE_PATH = (
    Path.home()
    / ".cache"
    / "kagglehub"
    / "datasets"
    / "anshdwvdi"
    / "list-of-all-universities-in-the-world"
    / "versions"
    / "1"
    / "list_of_univs.csv"
)


def _csv_path() -> Path:
    if _DEFAULT_KAGGLE_PATH.exists():
        return _DEFAULT_KAGGLE_PATH
    # Attempt live download as a fallback
    try:
        import kagglehub  # type: ignore
        downloaded = kagglehub.dataset_download(
            "anshdwvdi/list-of-all-universities-in-the-world"
        )
        candidate = Path(downloaded) / "list_of_univs.csv"
        if candidate.exists():
            return candidate
    except Exception as exc:  # noqa: BLE001
        logger.warning("kagglehub download failed: %s", exc)
    raise FileNotFoundError(
        f"list_of_univs.csv not found at {_DEFAULT_KAGGLE_PATH}."
    )


def _normalise(text: str) -> str:
    """Lowercase + strip accents + collapse whitespace — used as the upsert key."""
    nfkd = unicodedata.normalize("NFKD", text)
    ascii_only = nfkd.encode("ascii", "ignore").decode("ascii")
    return re.sub(r"\s+", " ", ascii_only).strip().lower()


def _clean(value: str | None) -> str:
    if not value:
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()


def _extract_domain(domains_str: str) -> str:
    """Parse the Python-list-as-string e.g. \"['karazin.ua']\" → 'karazin.ua'."""
    raw = _clean(domains_str)
    if not raw or raw == "[]":
        return ""
    try:
        parsed = ast.literal_eval(raw)
        if isinstance(parsed, list) and parsed:
            return _clean(str(parsed[0]))
    except Exception:  # noqa: BLE001
        pass
    return ""


async def seed_universities() -> None:
    """
    Import universities into MongoDB on first startup.
    Subsequent startups skip the import in ~1 ms.
    """
    # Skip if already seeded
    if await _col.count_documents({}, limit=1):
        logger.info("University collection already seeded — skipping import.")
        return

    try:
        csv_file = _csv_path()
    except FileNotFoundError as exc:
        logger.error("University seed skipped — %s", exc)
        return

    ops: list[UpdateOne] = []
    skipped = 0

    with open(csv_file, encoding="utf-8", errors="replace") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            name = _clean(row.get("name", ""))
            if not name:
                skipped += 1
                continue

            normalised = _normalise(name)
            doc = {
                "name": name,
                "normalised_name": normalised,
                "country": _clean(row.get("country", "")),
                # This dataset has state-province but no city column
                "state": _clean(row.get("state-province", "")),
                "city": "",
                "website": _extract_domain(row.get("domains", "")),
            }
            ops.append(
                UpdateOne(
                    {"normalised_name": normalised},
                    {"$setOnInsert": doc},
                    upsert=True,
                )
            )

    if not ops:
        logger.warning("University seed: no valid rows found in CSV.")
        return

    try:
        result = await _col.bulk_write(ops, ordered=False)
        logger.info(
            "University seed complete — %d inserted, %d skipped (empty name).",
            result.upserted_count,
            skipped,
        )
    except BulkWriteError as exc:
        logger.info(
            "University seed finished (some duplicates ignored) — inserted: %s",
            exc.details.get("nUpserted", "?"),
        )
