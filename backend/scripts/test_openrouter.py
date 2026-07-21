import asyncio

from app.core.config import settings
from app.services.llm_service import call_llm_json, llm_configured


async def main() -> None:
    print("openrouter_set", bool((settings.OPENROUTER_API_KEY or "").strip()))
    print("model", settings.OPENROUTER_MODEL)
    print("llm_configured", llm_configured())
    result = await call_llm_json(
        'Return JSON only with keys ok (boolean true) and provider (string "openrouter").',
        timeout=60.0,
    )
    print("result", result)
    assert result and result.get("ok") is True, f"Unexpected: {result}"
    print("OPENROUTER_OK")


if __name__ == "__main__":
    asyncio.run(main())
