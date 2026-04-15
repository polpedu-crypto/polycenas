"""
Gemini 2.5 Flash LLM client for cluster/super-cluster naming.
Supports batched concurrent calls for speed.
"""

import asyncio
import json
import re
from typing import Any, List, Dict, Optional, Tuple
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
            print(f"Gemini API error: {e}", flush=True)
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

    async def name_clusters_batch(
        self,
        tasks: List[Tuple[int, List[str]]],
        concurrency: int = 10,
    ) -> Dict[int, str]:
        """Name multiple clusters concurrently.

        Args:
            tasks: list of (topic_id, market_titles)
            concurrency: max parallel Gemini calls

        Returns:
            dict of topic_id -> name (only successful ones)
        """
        if not self.available:
            return {}

        sem = asyncio.Semaphore(concurrency)
        results: Dict[int, str] = {}

        async def _name_one(topic_id: int, titles: List[str]):
            async with sem:
                try:
                    name = await self.name_cluster(titles)
                    if name:
                        results[topic_id] = name
                except Exception as e:
                    print(f"  Batch naming failed for {topic_id}: {e}", flush=True)

        # Process in chunks to avoid overwhelming the API
        chunk_size = 5
        for start in range(0, len(tasks), chunk_size):
            chunk = tasks[start:start + chunk_size]
            await asyncio.gather(*[_name_one(tid, titles) for tid, titles in chunk])
            print(f"  Named {min(start + chunk_size, len(tasks))}/{len(tasks)} ({len(results)} OK)", flush=True)
            if start + chunk_size < len(tasks):
                await asyncio.sleep(0.5)
        return results

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

    # ────────────────────────────────────────────────────────────
    # Simulation JSON helpers
    # ────────────────────────────────────────────────────────────

    # On transient errors (503 / UNAVAILABLE / 429 / 500) we fall back down
    # this chain until one succeeds.
    _FALLBACK_CHAIN: Dict[str, List[str]] = {
        "gemini-2.5-pro": ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"],
        "gemini-2.5-flash": ["gemini-2.0-flash", "gemini-1.5-flash"],
        "gemini-2.0-flash": ["gemini-1.5-flash"],
    }

    def _fallback_models(self, model: str) -> List[str]:
        return self._FALLBACK_CHAIN.get(model, [])

    async def _chat_json(
        self,
        prompt: str,
        system: str = "",
        model: Optional[str] = None,
        temperature: float = 0.8,
        max_tokens: int = 600,
    ) -> Optional[Dict[str, Any]]:
        if not self.available:
            return None
        client = self._get_client()
        primary = model or settings.naming_model
        tried: List[str] = []
        for candidate in [primary, *self._fallback_models(primary)]:
            tried.append(candidate)
            try:
                response = client.models.generate_content(
                    model=candidate,
                    contents=prompt,
                    config=genai.types.GenerateContentConfig(
                        system_instruction=system,
                        temperature=temperature,
                        max_output_tokens=max_tokens,
                        response_mime_type="application/json",
                    ),
                )
                text = (response.text or "").strip()
                if not text:
                    return None
                if candidate != primary:
                    print(f"  [fallback] {primary} -> {candidate} succeeded", flush=True)
                return self._parse_json(text)
            except Exception as e:
                msg = str(e)
                transient = any(s in msg for s in ("503", "UNAVAILABLE", "429", "RESOURCE_EXHAUSTED", "500"))
                if transient:
                    print(f"  [transient] {candidate} failed, trying next in chain", flush=True)
                    continue
                print(f"Gemini JSON error ({candidate}): {e}", flush=True)
                return None
        print(f"Gemini JSON exhausted fallback chain: {tried}", flush=True)
        return None

    @staticmethod
    def _parse_json(text: str) -> Optional[Dict[str, Any]]:
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            m = re.search(r"\{.*\}", text, re.DOTALL)
            if m:
                try:
                    return json.loads(m.group(0))
                except json.JSONDecodeError:
                    return None
        return None

    async def generate_persona(
        self,
        market_title: str,
        event_title: Optional[str],
        cluster_name: Optional[str],
        model: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        prompt = (
            "Create a Reddit-style trader persona for a bot that will roleplay as an advocate "
            "for a specific prediction market outcome. Return JSON with keys: "
            "name (Reddit-style handle), bio (one sentence), persona (2-3 sentence trading style), "
            "interests (array of 3-5 short tags).\n\n"
            f"Market: {market_title}\n"
            f"Event: {event_title or 'N/A'}\n"
            f"Cluster theme: {cluster_name or 'N/A'}\n\n"
            "The persona should be biased toward 'YES' resolving on this specific market."
        )
        return await self._chat_json(
            prompt=prompt,
            system="You design distinct, believable trader personas. Output valid JSON only.",
            model=model,
            temperature=0.9,
            max_tokens=400,
        )

    async def generate_personas_batch(
        self,
        tasks: List[Tuple[int, Dict[str, Any]]],
        model: Optional[str] = None,
        concurrency: int = 8,
    ) -> Dict[int, Dict[str, Any]]:
        if not self.available:
            return {}
        sem = asyncio.Semaphore(concurrency)
        results: Dict[int, Dict[str, Any]] = {}

        async def _one(mid: int, info: Dict[str, Any]):
            async with sem:
                persona = await self.generate_persona(
                    market_title=info["market_title"],
                    event_title=info.get("event_title"),
                    cluster_name=info.get("cluster_name"),
                    model=model,
                )
                if persona:
                    results[mid] = persona

        chunk = 8
        for start in range(0, len(tasks), chunk):
            batch = tasks[start:start + chunk]
            await asyncio.gather(*[_one(mid, info) for mid, info in batch])
            print(f"  Personas: {min(start + chunk, len(tasks))}/{len(tasks)} ({len(results)} OK)", flush=True)
        return results

    async def agent_turn(
        self,
        *,
        agent_name: str,
        persona: str,
        market_title: str,
        event_title: Optional[str],
        cluster_name: Optional[str],
        feed: List[Dict[str, Any]],
        round_number: int,
        peers: List[Dict[str, Any]],
        model: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        feed_str = "\n".join(
            f"[#{f['seq']}] {f['agent_name']}: {f.get('title') or ''} — {(f.get('content') or '')[:160]}"
            for f in feed[-25:]
        ) or "(empty feed)"
        peers_str = "\n".join(
            f"- market_id={p['market_id']} agent={p['name']} market=\"{p['market_title']}\""
            for p in peers[:20]
        )
        prompt = (
            f"You are {agent_name}. {persona}\n\n"
            f"You advocate for YES on: \"{market_title}\" (event: {event_title or 'N/A'}, cluster: {cluster_name or 'N/A'}).\n\n"
            f"Round {round_number}. Recent feed:\n{feed_str}\n\n"
            f"Other agents in this thread (you may reply to any):\n{peers_str}\n\n"
            "Decide ONE action. Return JSON with keys:\n"
            '  action: one of "post" | "reply" | "skip"\n'
            "  title: string (post only, <=80 chars, optional)\n"
            "  content: string (<=280 chars) — required unless skip\n"
            '  stance: "bullish" | "bearish" | "neutral"  (your position on YOUR market)\n'
            "  target_market_id: integer (reply only — the peer market_id you reply to)\n\n"
            "Stay in character. Reference other agents' posts when replying. Be punchy."
        )
        return await self._chat_json(
            prompt=prompt,
            system="You roleplay as a Reddit trader. Output valid JSON only.",
            model=model,
            temperature=0.9,
            max_tokens=350,
        )

    async def synthesize_hedge(
        self,
        *,
        market_a: Dict[str, Any],
        market_b: Dict[str, Any],
        scores: Dict[str, float],
        sample_exchanges: List[str],
        model: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        exch = "\n".join(f"- {s}" for s in sample_exchanges[:8]) or "(none)"
        prompt = (
            "Two prediction markets emerged from a multi-agent simulation as a potential hedge pair.\n\n"
            f"Market A (id={market_a['id']}): \"{market_a['title']}\" "
            f"[cluster: {market_a.get('cluster_name')}]\n"
            f"Market B (id={market_b['id']}): \"{market_b['title']}\" "
            f"[cluster: {market_b.get('cluster_name')}]\n\n"
            "Heuristic signals from the simulation:\n"
            f"  co_movement={scores['co_movement']:.2f}  "
            f"contradiction={scores['contradiction']:.2f}  "
            f"interaction={scores['interaction']:.1f}  "
            f"hedge_score={scores['hedge_score']:.2f}\n\n"
            f"Sample exchanges between agents:\n{exch}\n\n"
            "Return JSON with keys:\n"
            "  confidence_score: 0-100 integer\n"
            '  direction: "positive" (correlated) | "negative" (anti-correlated)\n'
            "  reasoning: 2-4 paragraph natural-language explanation of WHY this is a hedge\n"
            "  key_factors: array of 3-5 short bullet phrases\n"
            '  recommended_combo: short string, e.g. "YES A + NO B"'
        )
        return await self._chat_json(
            prompt=prompt,
            system="You are a prediction-market quant analyst. Output valid JSON only.",
            model=model,
            temperature=0.4,
            max_tokens=900,
        )

    async def name_super_clusters_batch(
        self,
        tasks: List[Tuple[int, List[str]]],
        concurrency: int = 5,
    ) -> Dict[int, str]:
        """Name multiple super-clusters concurrently."""
        if not self.available:
            return {}

        sem = asyncio.Semaphore(concurrency)
        results: Dict[int, str] = {}

        async def _name_one(sid: int, summaries: List[str]):
            async with sem:
                try:
                    name = await self.name_super_cluster(summaries)
                    if name:
                        results[sid] = name
                except Exception as e:
                    print(f"  SC batch naming failed for {sid}: {e}", flush=True)

        chunk_size = 5
        for start in range(0, len(tasks), chunk_size):
            chunk = tasks[start:start + chunk_size]
            await asyncio.gather(*[_name_one(sid, sums) for sid, sums in chunk])
            print(f"  SC named {min(start + chunk_size, len(tasks))}/{len(tasks)} ({len(results)} OK)", flush=True)
            if start + chunk_size < len(tasks):
                await asyncio.sleep(0.5)
        return results
