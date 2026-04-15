"""
Gemini 2.5 Flash LLM client for cluster/super-cluster naming.
"""

from typing import List, Optional
from google import genai

from app.config import settings


class LLMService:
    def __init__(self):
        self._client = None

    @property
    def available(self) -> bool:
        return bool(settings.vertex_api_key)

    def _get_client(self) -> genai.Client:
        if self._client is None:
            self._client = genai.Client(api_key=settings.vertex_api_key)
        return self._client

    async def _chat(self, prompt: str, system: str = "", temperature: float = 0.3, max_tokens: int = 60) -> Optional[str]:
        if not self.available:
            return None

        try:
            client = self._get_client()
            response = client.models.generate_content(
                model=settings.naming_model,
                contents=prompt,
                config=genai.types.GenerateContentConfig(
                    system_instruction=system,
                    temperature=temperature,
                    max_output_tokens=max_tokens,
                ),
            )
            return response.text.strip() if response.text else None
        except Exception as e:
            print(f"Gemini API error: {e}")
            return None

    async def name_cluster(self, market_titles: List[str]) -> Optional[str]:
        if not self.available:
            return None

        titles_text = "\n".join(f"- {t}" for t in market_titles[:10])
        prompt = (
            "Given these prediction market titles that belong to one cluster, "
            "generate a clear, descriptive name (3-6 words) that captures the common theme.\n\n"
            f"Market titles:\n{titles_text}\n\n"
            "Return ONLY the name, nothing else."
        )
        result = await self._chat(
            prompt=prompt,
            system="You name thematic groups of prediction markets. Be specific.",
        )
        if result:
            return result.split("\n")[0].strip().strip("\"'")[:100]
        return None

    async def name_super_cluster(self, cluster_summaries: List[str]) -> Optional[str]:
        if not self.available:
            return None

        text = "\n".join(cluster_summaries)
        prompt = (
            "A super-cluster groups related prediction market clusters sharing a broad theme.\n\n"
            f"This super-cluster contains {len(cluster_summaries)} clusters:\n{text}\n\n"
            "Generate a clear name (3-6 words) a trader would understand.\n"
            "Examples: 'US Presidential Election 2026', 'Crypto Prices & ETFs', 'AI & Tech Companies'\n"
            "Return ONLY the name."
        )
        result = await self._chat(
            prompt=prompt,
            system="You name thematic groups of prediction markets. Be specific and descriptive.",
        )
        if result:
            return result.split("\n")[0].strip().strip("\"'")[:100]
        return None
