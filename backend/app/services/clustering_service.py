"""
Two-layer BERTopic + HDBSCAN clustering for Polymarket prediction markets.

Layer 1: Markets → Clusters (eventTitle grouping → BERTopic)
Layer 2: Clusters → Super-clusters (HDBSCAN on cluster embeddings)

Guarantees:
  - Every market belongs to exactly one cluster (outliers reassigned)
  - Every cluster belongs to exactly one super-cluster (outliers reassigned)

Adapted from PolymarketDashboard for the Polycenas hackathon MVP.
"""

import json
import re
import numpy as np
from typing import List, Dict, Tuple, Optional
from dataclasses import dataclass
from collections import defaultdict, Counter
from datetime import datetime, timezone
from prisma import Json as PrismaJson

from bertopic import BERTopic
from hdbscan import HDBSCAN
from umap import UMAP
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.preprocessing import normalize
from sklearn.feature_extraction.text import CountVectorizer

from prisma import Json as PrismaJson

from app.db.prisma_client import prisma
from app.config import settings
from app.services.llm_service import LLMService

import sys


def log(msg: str = ""):
    """Print with immediate flush so background tasks show output in real time."""
    print(msg, flush=True)
    sys.stdout.flush()


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class EventGroup:
    """Markets grouped by eventTitle."""
    event_title: str
    market_ids: List[int]
    markets: List

    def get_combined_text(self) -> str:
        titles = [m.title for m in self.markets if hasattr(m, "title") and m.title]
        return " | ".join(titles) if titles else self.event_title


# ---------------------------------------------------------------------------
# Layer 1 — Market clustering
# ---------------------------------------------------------------------------

class MarketClusteringService:
    """BERTopic-based clustering with eventTitle pre-grouping.

    Every market is guaranteed to end up in a cluster (no -1 outliers).
    """

    def __init__(
        self,
        min_cluster_size: int = None,
        min_samples: int = 3,
        max_cluster_size: int = None,
        embedding_model_name: str = None,
    ):
        self.min_cluster_size = min_cluster_size or settings.min_cluster_size
        self.min_samples = min_samples
        self.max_cluster_size = max_cluster_size or settings.max_cluster_size
        self.embedding_model_name = embedding_model_name or settings.embedding_model

        self.embedding_model: Optional[SentenceTransformer] = None
        self.topic_model: Optional[BERTopic] = None

    def _ensure_model(self):
        if self.embedding_model is None:
            log(f"Loading embedding model: {self.embedding_model_name}")
            self.embedding_model = SentenceTransformer(self.embedding_model_name)

    @staticmethod
    def _group_markets_by_event(markets: List) -> List[EventGroup]:
        groups_map: Dict[str, List] = defaultdict(list)
        for m in markets:
            event_title = getattr(m, "eventTitle", None)
            if not event_title or not event_title.strip():
                event_title = getattr(m, "title", f"Market_{m.id}")
            groups_map[event_title].append(m)

        groups = [
            EventGroup(event_title=title, market_ids=[m.id for m in ms], markets=ms)
            for title, ms in groups_map.items()
        ]
        log(f"Grouped {sum(len(g.markets) for g in groups)} markets into {len(groups)} event groups")
        return groups

    # ------------------------------------------------------------------

    async def cluster_markets(
        self, markets: List
    ) -> Tuple[Dict[int, int], Dict[int, str], Dict[int, Tuple[float, float]]]:
        """Full Layer-1 pipeline. Returns (market_to_cluster, cluster_names, market_positions)."""
        self._ensure_model()

        event_groups = self._group_markets_by_event(markets)
        if len(event_groups) < self.min_cluster_size:
            log(f"Too few event groups ({len(event_groups)}) — single-cluster fallback")
            return self._fallback_single_cluster(markets)

        documents = [eg.get_combined_text() for eg in event_groups]
        embeddings = self.embedding_model.encode(documents, show_progress_bar=True, convert_to_numpy=True)
        log(f"Embeddings: {embeddings.shape}")

        # BERTopic: UMAP → HDBSCAN
        self.topic_model = BERTopic(
            embedding_model=self.embedding_model,
            umap_model=UMAP(n_neighbors=15, n_components=5, min_dist=0.0, metric="cosine", random_state=42),
            hdbscan_model=HDBSCAN(
                min_cluster_size=self.min_cluster_size,
                min_samples=self.min_samples,
                metric="euclidean",
                cluster_selection_method="eom",
                prediction_data=True,
                cluster_selection_epsilon=0.0,
            ),
            vectorizer_model=CountVectorizer(stop_words="english", min_df=1, ngram_range=(1, 2)),
            top_n_words=5,
            verbose=True,
        )
        topics, _probs = self.topic_model.fit_transform(documents, embeddings)
        n_topics = len({t for t in topics if t != -1})
        n_outliers = sum(1 for t in topics if t == -1)
        log(f"[STEP 1/5] BERTopic done: {n_topics} topics, {n_outliers} outliers")

        # Split oversized clusters
        topics, n_splits = self._split_oversized_clusters(topics, event_groups, embeddings)
        log(f"[STEP 2/5] Split done: {n_splits} oversized clusters split")

        # Reassign ALL outliers so every market has a cluster
        topics, n_reassigned = self._reassign_outliers(topics, embeddings)
        log(f"[STEP 3/5] Outlier reassignment done: {n_reassigned} reassigned")

        # Names
        log(f"[STEP 4/5] Starting cluster naming...")
        cluster_names = await self._generate_cluster_names(topics, event_groups)
        log(f"[STEP 4/5] Cluster naming done")

        # Map back to individual markets
        market_to_cluster: Dict[int, int] = {}
        for eg, tid in zip(event_groups, topics):
            for mid in eg.market_ids:
                market_to_cluster[mid] = tid

        # Merge clusters with similar names
        market_to_cluster, cluster_names = _merge_similar_clusters(market_to_cluster, cluster_names)

        # 2D positions
        log(f"[STEP 5/5] Generating 2D positions...")
        market_positions = self._generate_positions(event_groups, topics, embeddings)

        n_clusters = len({t for t in topics if t != -1})
        log(f"Layer 1 done: {n_clusters} clusters, {len(market_to_cluster)} markets, 0 orphans")
        return market_to_cluster, cluster_names, market_positions

    # ------------------------------------------------------------------
    # Naming
    # ------------------------------------------------------------------

    async def _generate_cluster_names(
        self, topics: List[int], event_groups: List[EventGroup]
    ) -> Dict[int, str]:
        names: Dict[int, str] = {}
        unique_topics = sorted({t for t in topics if t != -1})
        total = len(unique_topics)

        log(f"\nNaming {total} clusters...")
        llm = LLMService()
        log(f"  LLM available: {llm.available} (model: {settings.naming_model})")

        # Build all naming tasks
        tasks: list = []
        topic_egs: dict = {}
        for tid in unique_topics:
            cluster_egs = [eg for eg, t in zip(event_groups, topics) if t == tid]
            titles = [eg.event_title for eg in cluster_egs[:10]]
            tasks.append((tid, titles))
            topic_egs[tid] = cluster_egs

        # Batch LLM naming (10 concurrent calls)
        if llm.available:
            log(f"  Batching {len(tasks)} LLM calls (concurrency=10)...")
            llm_names = await llm.name_clusters_batch(tasks, concurrency=10)
            names.update(llm_names)
            log(f"  LLM named {len(llm_names)}/{total} clusters")

        # Fallback for anything LLM missed: retry once, then c-TF-IDF, then title
        remaining = [tid for tid in unique_topics if tid not in names]
        if remaining and llm.available:
            log(f"  Retrying {len(remaining)} failed clusters...")
            retry_tasks = [(tid, [eg.event_title for eg in topic_egs[tid][:10]]) for tid in remaining]
            retry_names = await llm.name_clusters_batch(retry_tasks, concurrency=5)
            names.update(retry_names)
            log(f"  Retry named {len(retry_names)}/{len(remaining)}")

        # c-TF-IDF + title fallback for any still unnamed
        remaining = [tid for tid in unique_topics if tid not in names]
        tfidf_ok = 0
        fallback_ok = 0
        for tid in remaining:
            # c-TF-IDF
            try:
                topic_words = self.topic_model.get_topic(tid)
                if topic_words:
                    names[tid] = " ".join(w for w, _ in topic_words[:4]).title()
                    tfidf_ok += 1
                    continue
            except Exception:
                pass
            # Title
            egs = topic_egs.get(tid, [])
            if egs:
                best = max(egs, key=lambda eg: len(eg.markets))
                names[tid] = best.event_title[:80]
            else:
                names[tid] = f"Cluster {tid}"
            fallback_ok += 1

        llm_total = total - tfidf_ok - fallback_ok
        log(f"Naming done: {llm_total} LLM, {tfidf_ok} c-TF-IDF, {fallback_ok} title fallback")
        return names

    # ------------------------------------------------------------------
    # Outlier reassignment — guarantees no market is left as -1
    # ------------------------------------------------------------------

    @staticmethod
    def _reassign_outliers(topics: List[int], embeddings: np.ndarray) -> Tuple[List[int], int]:
        topics = list(topics)
        outlier_idx = [i for i, t in enumerate(topics) if t == -1]
        cluster_ids = sorted({t for t in topics if t != -1})
        if not outlier_idx or not cluster_ids:
            return topics, 0

        cid_map = {cid: i for i, cid in enumerate(cluster_ids)}
        dim = embeddings.shape[1]
        sums = np.zeros((len(cluster_ids), dim))
        counts = np.zeros(len(cluster_ids))
        for i, t in enumerate(topics):
            if t != -1:
                sums[cid_map[t]] += embeddings[i]
                counts[cid_map[t]] += 1
        centroids = sums / counts[:, np.newaxis]

        sims = cosine_similarity(embeddings[outlier_idx], centroids)
        for row, orig in enumerate(outlier_idx):
            topics[orig] = cluster_ids[int(sims[row].argmax())]

        return topics, len(outlier_idx)

    # ------------------------------------------------------------------
    # Split oversized clusters
    # ------------------------------------------------------------------

    def _split_oversized_clusters(
        self, topics: List[int], event_groups: List[EventGroup], embeddings: np.ndarray
    ) -> Tuple[List[int], int]:
        cluster_groups: Dict[int, List[int]] = defaultdict(list)
        for idx, tid in enumerate(topics):
            if tid != -1:
                cluster_groups[tid].append(idx)

        oversized = [
            (tid, indices)
            for tid, indices in cluster_groups.items()
            if sum(len(event_groups[i].markets) for i in indices) > self.max_cluster_size
        ]
        if not oversized:
            return topics, 0

        updated = list(topics)
        next_id = max(topics) + 1
        total_splits = 0

        for tid, indices in oversized:
            sub = HDBSCAN(
                min_cluster_size=max(2, len(indices) // 4),
                min_samples=1,
                metric="euclidean",
                cluster_selection_method="eom",
            )
            sub_labels = sub.fit_predict(embeddings[indices])
            label_map = {}
            for sl in set(sub_labels):
                if sl != -1:
                    label_map[sl] = next_id
                    next_id += 1
            for i, sl in enumerate(sub_labels):
                if sl != -1:
                    updated[indices[i]] = label_map[sl]
            total_splits += len(label_map)

        return updated, total_splits

    # ------------------------------------------------------------------
    # 2D positions
    # ------------------------------------------------------------------

    def _generate_positions(
        self, event_groups: List[EventGroup], topics: List[int], embeddings: np.ndarray
    ) -> Dict[int, Tuple[float, float]]:
        umap_2d = UMAP(n_neighbors=15, n_components=2, min_dist=0.1, metric="cosine", random_state=42)
        pos = umap_2d.fit_transform(embeddings)
        market_positions: Dict[int, Tuple[float, float]] = {}
        for eg, (x, y) in zip(event_groups, pos):
            for mid in eg.market_ids:
                market_positions[mid] = (float(x), float(y))
        return market_positions

    @staticmethod
    def _fallback_single_cluster(markets):
        return (
            {m.id: 0 for m in markets},
            {0: "All Markets"},
            {m.id: (0.0, 0.0) for m in markets},
        )


# ---------------------------------------------------------------------------
# Layer 2 — Super-cluster detection
# ---------------------------------------------------------------------------

class SuperClusterService:
    """HDBSCAN on cluster-level embeddings to form super-clusters.

    Every cluster is guaranteed to end up in a super-cluster (outliers reassigned).
    """

    def __init__(self, embedding_model: SentenceTransformer = None, model_name: str = None):
        if embedding_model:
            self.embedding_model = embedding_model
        else:
            self.embedding_model = SentenceTransformer(model_name or settings.embedding_model)
        self.llm = LLMService()

    def _create_cluster_document(self, cluster_name: str, markets: List) -> str:
        parts = [cluster_name]
        seen_events: set = set()
        for m in markets:
            event = getattr(m, "eventTitle", None) or getattr(m, "title", None) or ""
            if event and event not in seen_events:
                seen_events.add(event)
                desc = getattr(m, "description", None) or ""
                parts.append(f"{m.title} {desc}" if desc else m.title)
        return " | ".join(parts)

    async def build_super_clusters(self, clusters_data: List[Dict]) -> Dict:
        """Run Layer 2: embed clusters → HDBSCAN → reassign outliers → name.

        Returns dict with super_clusters, super_cluster_names, positions.
        """
        if len(clusters_data) < 2:
            return {"super_clusters": {c["id"]: 0 for c in clusters_data}, "super_cluster_names": {0: "All Clusters"}, "positions": {}}

        # Embed each cluster as a document
        documents = []
        cid_to_idx: Dict[int, int] = {}
        for idx, c in enumerate(clusters_data):
            cid = c["id"]
            cid_to_idx[cid] = idx
            documents.append(self._create_cluster_document(
                c.get("name", f"Cluster {cid}") or f"Cluster {cid}",
                c.get("markets", []),
            ))

        embeddings = self.embedding_model.encode(documents, show_progress_bar=True, convert_to_numpy=True)
        log(f"Cluster embeddings: {embeddings.shape}")

        # HDBSCAN for super-clusters
        super_clusters = self._detect_super_clusters(embeddings, cid_to_idx)

        # Reassign outlier clusters to nearest super-cluster
        super_clusters = self._reassign_outlier_clusters(super_clusters, embeddings, cid_to_idx)

        # Name super-clusters
        super_names = await self._name_super_clusters(super_clusters, clusters_data)

        # 2D positions
        positions = self._generate_positions(embeddings, cid_to_idx)

        n_sc = len(set(super_clusters.values()))
        log(f"Layer 2 done: {n_sc} super-clusters, 0 orphan clusters")

        return {
            "super_clusters": super_clusters,
            "super_cluster_names": super_names,
            "positions": positions,
        }

    def _detect_super_clusters(
        self, embeddings: np.ndarray, cid_to_idx: Dict[int, int]
    ) -> Dict[int, int]:
        n = len(embeddings)
        if n < 3:
            return {cid: 0 for cid in cid_to_idx}

        reduced = UMAP(
            n_components=10,
            n_neighbors=min(10, max(2, n - 1)),
            min_dist=0.0,
            metric="cosine",
            random_state=42,
        ).fit_transform(embeddings)

        normed = normalize(reduced, norm="l2")

        clusterer = HDBSCAN(
            min_cluster_size=max(2, n // 30),
            min_samples=1,
            metric="euclidean",
            cluster_selection_method="leaf",
            cluster_selection_epsilon=0.0,
            prediction_data=True,
        )
        labels = clusterer.fit_predict(normed)

        idx_to_cid = {v: k for k, v in cid_to_idx.items()}
        result = {idx_to_cid[i]: int(l) for i, l in enumerate(labels)}

        n_sc = len({l for l in labels if l != -1})
        n_out = sum(1 for l in labels if l == -1)
        log(f"Super-clusters: {n_sc} detected, {n_out} outliers (will be reassigned)")
        return result

    @staticmethod
    def _reassign_outlier_clusters(
        super_clusters: Dict[int, int], embeddings: np.ndarray, cid_to_idx: Dict[int, int]
    ) -> Dict[int, int]:
        """Assign every outlier cluster (-1) to its nearest super-cluster by cosine similarity."""
        outlier_cids = [cid for cid, sid in super_clusters.items() if sid == -1]
        valid_sids = sorted({sid for sid in super_clusters.values() if sid != -1})

        if not outlier_cids or not valid_sids:
            # Edge case: everything is an outlier — put them all in super-cluster 0
            if not valid_sids and outlier_cids:
                return {cid: 0 for cid in super_clusters}
            return super_clusters

        # Build centroids for each super-cluster
        sid_map = {sid: i for i, sid in enumerate(valid_sids)}
        dim = embeddings.shape[1]
        sums = np.zeros((len(valid_sids), dim))
        counts = np.zeros(len(valid_sids))
        for cid, sid in super_clusters.items():
            if sid != -1:
                idx = cid_to_idx[cid]
                sums[sid_map[sid]] += embeddings[idx]
                counts[sid_map[sid]] += 1
        centroids = sums / np.maximum(counts[:, np.newaxis], 1)

        # Assign each outlier to nearest centroid
        outlier_embeddings = np.array([embeddings[cid_to_idx[cid]] for cid in outlier_cids])
        sims = cosine_similarity(outlier_embeddings, centroids)

        result = dict(super_clusters)
        for i, cid in enumerate(outlier_cids):
            result[cid] = valid_sids[int(sims[i].argmax())]

        log(f"Reassigned {len(outlier_cids)} outlier clusters to nearest super-cluster")
        return result

    async def _name_super_clusters(
        self, super_clusters: Dict[int, int], clusters_data: List[Dict]
    ) -> Dict[int, str]:
        groups: Dict[int, List[Dict]] = defaultdict(list)
        for c in clusters_data:
            sid = super_clusters.get(c["id"], -1)
            if sid != -1:
                groups[sid].append(c)

        total = len(groups)
        log(f"\nNaming {total} super-clusters...")

        # Build summaries for each super-cluster
        sc_summaries: Dict[int, list] = {}
        for sid, clusters in sorted(groups.items()):
            summaries = []
            for c in clusters[:12]:
                name = c.get("name", f"Cluster {c['id']}")
                sample_titles = [
                    getattr(m, "title", "")[:120]
                    for m in c.get("markets", [])[:5]
                    if getattr(m, "title", "")
                ]
                summary = f"Cluster: {name}"
                if sample_titles:
                    summary += f"\n  Markets: {' | '.join(sample_titles)}"
                summaries.append(summary)
            sc_summaries[sid] = summaries

        # Batch LLM naming
        names: Dict[int, str] = {}
        tasks = [(sid, sums) for sid, sums in sc_summaries.items()]
        if self.llm.available:
            log(f"  Batching {len(tasks)} SC LLM calls (concurrency=5)...")
            llm_names = await self.llm.name_super_clusters_batch(tasks, concurrency=5)
            names.update(llm_names)
            log(f"  LLM named {len(llm_names)}/{total} super-clusters")
            for sid, name in sorted(llm_names.items()):
                n_clusters = len(groups.get(sid, []))
                log(f"    SC {sid} ({n_clusters} clusters): \"{name}\"")

        # Fallback for unnamed
        fallback_ok = 0
        for sid in sorted(groups.keys()):
            if sid in names:
                continue
            clusters = groups[sid]
            all_kw = []
            for c in clusters:
                all_kw.extend(c.get("keywords", [])[:3])
            counts = Counter(kw.lower() for kw in all_kw if kw)
            if counts:
                names[sid] = " & ".join(kw for kw, _ in counts.most_common(2)).title()
            else:
                cname = clusters[0].get("name", "") if clusters else ""
                names[sid] = cname[:50] or f"Super-cluster {sid}"
            fallback_ok += 1
            log(f"    SC {sid} fallback: \"{names[sid]}\"")

        log(f"SC naming done: {total - fallback_ok} LLM, {fallback_ok} fallback")
        return names

    def _generate_positions(
        self, embeddings: np.ndarray, cid_to_idx: Dict[int, int]
    ) -> Dict[int, Tuple[float, float]]:
        n = len(embeddings)
        umap_2d = UMAP(
            n_neighbors=max(2, min(15, n - 1)),
            n_components=2,
            min_dist=0.1,
            metric="cosine",
            random_state=42,
        )
        pos = umap_2d.fit_transform(embeddings)
        idx_to_cid = {v: k for k, v in cid_to_idx.items()}
        return {idx_to_cid[i]: (float(x), float(y)) for i, (x, y) in enumerate(pos)}


# ---------------------------------------------------------------------------
# Orchestrator — wires Layer 1 + Layer 2 + DB persistence
# ---------------------------------------------------------------------------

class GraphRebuildService:
    """Orchestrates full graph rebuild: fetch markets → cluster → super-cluster → persist."""

    async def rebuild(self) -> Dict:
        log("=" * 60)
        log("Starting full graph rebuild")
        log("=" * 60)

        # 1. Fetch open markets
        now = datetime.now(timezone.utc)
        max_m = settings.max_markets if settings.max_markets > 0 else 5000
        all_markets = await prisma.market.find_many(
            where={"OR": [{"resolvedAt": None}, {"resolvedAt": {"gte": now}}]},
        )
        all_markets.sort(key=lambda m: m.volume or 0, reverse=True)
        markets = all_markets[:max_m] if len(all_markets) > max_m else all_markets
        log(f"Fetched {len(markets)} markets")

        if len(markets) < 2:
            return {"status": "error", "message": "Not enough markets"}

        # 2. Layer 1 — cluster markets
        l1 = MarketClusteringService()
        market_to_cluster, cluster_names, market_positions = await l1.cluster_markets(markets)

        # 3. Snapshot old clusters for later deletion
        old_clusters = await prisma.cluster.find_many(where={"isGlobal": True})
        old_ids = [c.id for c in old_clusters]

        # 4. Persist new clusters + cluster-market links
        cluster_markets_map: Dict[int, list] = defaultdict(list)
        for m in markets:
            tid = market_to_cluster.get(m.id)
            if tid is not None:
                cluster_markets_map[tid].append(m)

        topic_to_db_id: Dict[int, int] = {}
        cluster_count = 0
        market_count = 0
        total_clusters_to_save = sum(1 for ms in cluster_markets_map.values() if len(ms) >= 2)
        log(f"Persisting {total_clusters_to_save} clusters to DB...")

        # Phase A: Create all cluster rows
        log(f"  Creating {total_clusters_to_save} cluster rows...")
        for tid, c_markets in cluster_markets_map.items():
            if len(c_markets) < 2:
                continue
            name = cluster_names.get(tid, f"Cluster {tid}")
            keywords = self._extract_keywords(l1, tid, name)
            positions = [market_positions[m.id] for m in c_markets if m.id in market_positions]
            cx = sum(x for x, _ in positions) / len(positions) if positions else 0.0
            cy = sum(y for _, y in positions) / len(positions) if positions else 0.0
            total_vol = sum(m.volume or 0 for m in c_markets)
            top = max(c_markets, key=lambda m: m.volume or 0)

            cluster = await prisma.cluster.create(data={
                "isGlobal": True,
                "centroidX": cx,
                "centroidY": cy,
                "keywords": keywords,
                "name": name,
                "totalVolume": float(total_vol),
                "topMarketId": top.id,
                "topMarketTitle": (top.title or "")[:200],
            })
            topic_to_db_id[tid] = cluster.id
            cluster_count += 1
        log(f"  Created {cluster_count} cluster rows")

        # Phase B: Batch create all ClusterMarket links
        log(f"  Creating ClusterMarket links...")
        cm_data = []
        for tid, c_markets in cluster_markets_map.items():
            if len(c_markets) < 2 or tid not in topic_to_db_id:
                continue
            db_cluster_id = topic_to_db_id[tid]
            for m in c_markets:
                cm_data.append({"clusterId": db_cluster_id, "marketId": m.id})
                market_count += 1

        # Batch in chunks of 500
        for i in range(0, len(cm_data), 500):
            chunk = cm_data[i:i + 500]
            await prisma.clustermarket.create_many(data=chunk, skip_duplicates=True)
            log(f"    ClusterMarket: {min(i + 500, len(cm_data))}/{len(cm_data)}")
        log(f"  Created {len(cm_data)} ClusterMarket links")

        # Phase C: Batch update market positions via raw SQL
        log(f"  Updating {market_count} market positions...")
        batch_size = 200
        position_updates = []
        for tid, c_markets in cluster_markets_map.items():
            if len(c_markets) < 2:
                continue
            for m in c_markets:
                x, y = market_positions.get(m.id, (0.0, 0.0))
                position_updates.append((m.id, float(x), float(y)))

        for i in range(0, len(position_updates), batch_size):
            chunk = position_updates[i:i + batch_size]
            cases_x = " ".join(f"WHEN {mid} THEN {x}" for mid, x, y in chunk)
            cases_y = " ".join(f"WHEN {mid} THEN {y}" for mid, x, y in chunk)
            ids = ",".join(str(mid) for mid, x, y in chunk)
            await prisma.execute_raw(
                f'UPDATE "Market" SET "embeddingX" = CASE "id" {cases_x} END, '
                f'"embeddingY" = CASE "id" {cases_y} END, '
                f'"graphEmbedding" = \'[]\' '
                f'WHERE "id" IN ({ids})'
            )
            if (i + batch_size) % 1000 == 0 or i + batch_size >= len(position_updates):
                log(f"    Positions: {min(i + batch_size, len(position_updates))}/{len(position_updates)}")

        log(f"DB persist done: {cluster_count} clusters, {market_count} markets")

        # 5. Layer 2 — super-clusters (no edges needed for MVP)
        log("\nStarting Layer 2 — super-cluster detection...")
        db_clusters = await prisma.cluster.find_many(
            where={"id": {"in": list(topic_to_db_id.values())}},
            include={"clusterMarkets": {"include": {"market": True}}},
        )
        clusters_data = [
            {
                "id": c.id,
                "name": c.name or f"Cluster {c.id}",
                "keywords": list(c.keywords) if c.keywords else [],
                "markets": [cm.market for cm in c.clusterMarkets],
                "size": len(c.clusterMarkets),
            }
            for c in db_clusters
        ]

        if len(clusters_data) >= 2:
            l2 = SuperClusterService(embedding_model=l1.embedding_model)
            graph = await l2.build_super_clusters(clusters_data)

            super_clusters = graph["super_clusters"]
            super_names = graph["super_cluster_names"]
            positions = graph["positions"]

            # Update cluster positions + super-cluster assignment
            for c in db_clusters:
                sid = super_clusters.get(c.id)
                pos = positions.get(c.id)
                update_data: dict = {}
                if pos:
                    update_data["centroidX"] = float(pos[0])
                    update_data["centroidY"] = float(pos[1])
                if sid is not None:
                    update_data["superClusterId"] = sid
                if update_data:
                    await prisma.cluster.update(where={"id": c.id}, data=update_data)

            # Upsert SuperCluster rows
            active_sids = sorted(set(super_clusters.values()))
            for sid in active_sids:
                name = (super_names.get(sid) or "").strip() or f"Super-cluster {sid}"
                count = sum(1 for s in super_clusters.values() if s == sid)
                await prisma.supercluster.upsert(
                    where={"id": sid},
                    data={
                        "create": {"id": sid, "name": name[:100], "metadata": PrismaJson({"cluster_count": count})},
                        "update": {"name": name[:100], "metadata": PrismaJson({"cluster_count": count})},
                    },
                )
            if active_sids:
                await prisma.supercluster.delete_many(where={"id": {"not_in": active_sids}})

        # 6. Delete all clusters that aren't part of this rebuild
        new_ids = list(topic_to_db_id.values())
        stale = await prisma.cluster.find_many(where={"id": {"not_in": new_ids}})
        stale_ids = [c.id for c in stale]
        if stale_ids:
            log(f"Deleting {len(stale_ids)} stale clusters (keeping {len(new_ids)} new)...")
            await prisma.clustermarket.delete_many(where={"clusterId": {"in": stale_ids}})
            await prisma.cluster.delete_many(where={"id": {"in": stale_ids}})
            log(f"Deleted {len(stale_ids)} stale clusters")

        result = {
            "status": "completed",
            "markets_clustered": market_count,
            "clusters_created": cluster_count,
        }
        log(f"Graph rebuild complete: {result}")
        return result

    @staticmethod
    def _extract_keywords(l1: MarketClusteringService, topic_id: int, cluster_name: str) -> List[str]:
        keywords = []
        try:
            if l1.topic_model:
                tw = l1.topic_model.get_topic(topic_id)
                if tw:
                    keywords = [w for w, _ in tw[:8] if w]
        except Exception:
            pass
        if not keywords:
            stop = {"the", "will", "be", "a", "an", "and", "or", "for", "by", "to", "of", "in", "on", "at"}
            keywords = [w for w in cluster_name.lower().replace("?", "").split() if w not in stop and len(w) > 2][:5]
        return keywords or [cluster_name.lower()[:20]]


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------

def _merge_similar_clusters(
    market_to_cluster: Dict[int, int], cluster_names: Dict[int, str], threshold: float = 0.6
) -> Tuple[Dict[int, int], Dict[int, str]]:
    def words(name: str) -> set:
        stop = {"the", "will", "be", "a", "an", "and", "or", "for", "by", "to", "of", "in", "on", "at", "vs"}
        return set(re.sub(r"[^a-z0-9\s]", "", name.lower()).split()) - stop

    def overlap(a: set, b: set) -> float:
        if not a or not b:
            return 0.0
        return len(a & b) / min(len(a), len(b))

    tw = {tid: words(n) for tid, n in cluster_names.items() if tid != -1}
    sizes: Dict[int, int] = defaultdict(int)
    for tid in market_to_cluster.values():
        sizes[tid] += 1

    merge_map: Dict[int, int] = {}
    ids = list(tw.keys())
    for i, a in enumerate(ids):
        if a in merge_map:
            continue
        for b in ids[i + 1:]:
            if b in merge_map:
                continue
            if overlap(tw[a], tw[b]) >= threshold:
                if sizes[a] >= sizes[b]:
                    merge_map[b] = a
                    sizes[a] += sizes[b]
                else:
                    merge_map[a] = b
                    sizes[b] += sizes[a]
                    break

    if not merge_map:
        return market_to_cluster, cluster_names

    def resolve(tid):
        while tid in merge_map:
            tid = merge_map[tid]
        return tid

    new_m2c = {mid: resolve(tid) for mid, tid in market_to_cluster.items()}
    new_names = {tid: n for tid, n in cluster_names.items() if tid not in merge_map}
    log(f"Merged {len(merge_map)} similar clusters ({len(cluster_names)} → {len(new_names)})")
    return new_m2c, new_names
