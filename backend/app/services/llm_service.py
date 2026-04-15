"""
Lightweight OpenRouter LLM client for cluster/super-cluster naming.
"""

import httpx
from typing import List, Optional

from app.config import settings

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"


class LLMService:
    def __init__(self):
        self.api_key = settings.openrouter_api_key
        self.model = settings.cheap_model

    @property
    def available(self) -> bool:
        return bool(self.api_key)

    async def _chat(self, messages: list, temperature: float = 0.3, max_tokens: int = 60) -> Optional[str]:
        if not self.available:
            return None

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                OPENROUTER_URL,
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self.model,
                    "messages": messages,
                    "temperature": temperature,
                    "max_tokens": max_tokens,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            return data["choices"][0]["message"]["content"].strip()

    async def name_cluster(self, market_titles: List[str]) -> Optional[str]:
        if not self.available:
            return None

        titles_text = "\n".join(f"- {t}" for t in market_titles[:10])
        prompt = (
            "You are naming clusters for a Polymarket prediction market dashboard.\n"
            "Given these market titles that belong to one cluster, generate a clear, "
            "descriptive name (3-6 words) that captures the common theme.\n\n"
            f"Market titles:\n{titles_text}\n\n"
            "Return ONLY the name, nothing else."
        )
        result = await self._chat([
            {"role": "system", "content": "You name thematic groups of prediction markets. Be specific."},
            {"role": "user", "content": prompt},
        ])
        if result:
            return result.split("\n")[0].strip().strip("\"'")[:100]
        return None

    async def name_super_cluster(self, cluster_summaries: List[str]) -> Optional[str]:
        if not self.available:
            return None

        text = "\n".join(cluster_summaries)
        prompt = (
            "You are naming super-clusters for a Polymarket prediction market dashboard.\n"
            "A super-cluster groups related clusters sharing a broad theme.\n\n"
            f"This super-cluster contains {len(cluster_summaries)} clusters:\n{text}\n\n"
            "Generate a clear name (3-6 words) a trader would understand.\n"
            "Examples: 'US Presidential Election 2026', 'Crypto Prices & ETFs', 'AI & Tech Companies'\n"
            "Return ONLY the name."
        )
        result = await self._chat([
            {"role": "system", "content": "You name thematic groups of prediction markets. Be specific and descriptive."},
            {"role": "user", "content": prompt},
        ])
        if result:
            return result.split("\n")[0].strip().strip("\"'")[:100]
        return None
