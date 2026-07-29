"""
University seed service — imports the Kaggle global-universities-database CSV
into the `universities` MongoDB collection.

Idempotent: uses bulk_write with upsert on normalised_name.
Fast: processes the entire CSV in a single bulk operation.
Only called once at application startup (see main.py lifespan).
"""

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

_DEFAULT_KAGGLE_PATH = (
    Path.home()
    / ".cache"
    / "kagglehub"
    / "datasets"
    / "dropthe"
    / "global-universities-database"
    / "versions"
    / "1"
    / "universities.csv"
)


def _csv_path() -> Path:
    if _DEFAULT_KAGGLE_PATH.exists():
        return _DEFAULT_KAGGLE_PATH
    try:
        import kagglehub  # type: ignore
        downloaded = kagglehub.dataset_download("dropthe/global-universities-database")
        candidate = Path(downloaded) / "universities.csv"
        if candidate.exists():
            return candidate
    except Exception as exc:  # noqa: BLE001
        logger.warning("kagglehub download failed: %s", exc)
    raise FileNotFoundError(
        f"universities.csv not found at {_DEFAULT_KAGGLE_PATH}."
    )


def _normalise(text: str) -> str:
    nfkd = unicodedata.normalize("NFKD", text)
    ascii_only = nfkd.encode("ascii", "ignore").decode("ascii")
    return re.sub(r"\s+", " ", ascii_only).strip().lower()


def _clean(value: str | None) -> str:
    if not value:
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()


async def seed_universities() -> None:
    # Skip if already seeded — avoids any startup cost on subsequent runs.
    if await _col.count_documents({}, limit=1):
        logger.info("University collection already seeded — skipping import.")
        return

    try:
        csv_file = _csv_path()
    except FileNotFoundError as exc:
        logger.error("University seed skipped — %s", exc)
        return

    ops = []
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
                "city": _clean(row.get("city", "")),
                "state": "",
                "website": _clean(row.get("website", "")),
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
            "University seed complete — %d inserted, %d skipped (invalid rows).",
            result.upserted_count,
            skipped,
        )
    except BulkWriteError as exc:
        # Partial success is fine — duplicate key errors on normalised_name are expected
        # if the collection was partially seeded before.
        logger.info(
            "University seed finished with partial errors (likely duplicate keys) — %s",
            exc.details.get("nUpserted", "?"),
        )
