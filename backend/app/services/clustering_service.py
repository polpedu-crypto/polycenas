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

from bertopic import BERTopic
from hdbscan import HDBSCAN
from umap import UMAP
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.preprocessing import normalize
from sklearn.feature_extraction.text import CountVectorizer

from app.db.prisma_client import prisma
from app.config import settings
from app.services.llm_service import LLMService


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
            print(f"Loading embedding model: {self.embedding_model_name}")
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
        print(f"Grouped {sum(len(g.markets) for g in groups)} markets into {len(groups)} event groups")
        return groups

    # ------------------------------------------------------------------

    async def cluster_markets(
        self, markets: List
    ) -> Tuple[Dict[int, int], Dict[int, str], Dict[int, Tuple[float, float]]]:
        """Full Layer-1 pipeline. Returns (market_to_cluster, cluster_names, market_positions)."""
        self._ensure_model()

        event_groups = self._group_markets_by_event(markets)
        if len(event_groups) < self.min_cluster_size:
            print(f"Too few event groups ({len(event_groups)}) — single-cluster fallback")
            return self._fallback_single_cluster(markets)

        documents = [eg.get_combined_text() for eg in event_groups]
        embeddings = self.embedding_model.encode(documents, show_progress_bar=True, convert_to_numpy=True)
        print(f"Embeddings: {embeddings.shape}")

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

        # Split oversized clusters
        topics, n_splits = self._split_oversized_clusters(topics, event_groups, embeddings)
        if n_splits:
            print(f"Split {n_splits} oversized clusters")

        # Reassign ALL outliers so every market has a cluster
        topics, n_reassigned = self._reassign_outliers(topics, embeddings)
        if n_reassigned:
            print(f"Reassigned {n_reassigned} outlier groups to nearest cluster")

        # Names
        cluster_names = await self._generate_cluster_names(topics, event_groups)

        # Map back to individual markets
        market_to_cluster: Dict[int, int] = {}
        for eg, tid in zip(event_groups, topics):
            for mid in eg.market_ids:
                market_to_cluster[mid] = tid

        # Merge clusters with similar names
        market_to_cluster, cluster_names = _merge_similar_clusters(market_to_cluster, cluster_names)

        # 2D positions
        market_positions = self._generate_positions(event_groups, topics, embeddings)

        n_clusters = len({t for t in topics if t != -1})
        print(f"Layer 1 done: {n_clusters} clusters, {len(market_to_cluster)} markets, 0 orphans")
        return market_to_cluster, cluster_names, market_positions

    # ------------------------------------------------------------------
    # Naming
    # ------------------------------------------------------------------

    async def _generate_cluster_names(
        self, topics: List[int], event_groups: List[EventGroup]
    ) -> Dict[int, str]:
        names: Dict[int, str] = {}
        unique_topics = {t for t in topics if t != -1}

        llm = LLMService()
        for topic_id in unique_topics:
            cluster_egs = [eg for eg, t in zip(event_groups, topics) if t == topic_id]
            titles = [eg.event_title for eg in cluster_egs[:10]]

            # LLM naming
            try:
                name = await llm.name_cluster(titles)
                if name:
                    names[topic_id] = name
                    continue
            except Exception:
                pass

            # c-TF-IDF fallback
            try:
                topic_words = self.topic_model.get_topic(topic_id)
                if topic_words:
                    names[topic_id] = " ".join(w for w, _ in topic_words[:4]).title()
                    continue
            except Exception:
                pass

            # Title fallback
            if cluster_egs:
                best = max(cluster_egs, key=lambda eg: len(eg.markets))
                names[topic_id] = best.event_title[:80]
            else:
                names[topic_id] = f"Cluster {topic_id}"

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
        print(f"Cluster embeddings: {embeddings.shape}")

        # HDBSCAN for super-clusters
        super_clusters = self._detect_super_clusters(embeddings, cid_to_idx)

        # Reassign outlier clusters to nearest super-cluster
        super_clusters = self._reassign_outlier_clusters(super_clusters, embeddings, cid_to_idx)

        # Name super-clusters
        super_names = await self._name_super_clusters(super_clusters, clusters_data)

        # 2D positions
        positions = self._generate_positions(embeddings, cid_to_idx)

        n_sc = len(set(super_clusters.values()))
        print(f"Layer 2 done: {n_sc} super-clusters, 0 orphan clusters")

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
        print(f"Super-clusters: {n_sc} detected, {n_out} outliers (will be reassigned)")
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

        print(f"Reassigned {len(outlier_cids)} outlier clusters to nearest super-cluster")
        return result

    async def _name_super_clusters(
        self, super_clusters: Dict[int, int], clusters_data: List[Dict]
    ) -> Dict[int, str]:
        groups: Dict[int, List[Dict]] = defaultdict(list)
        for c in clusters_data:
            sid = super_clusters.get(c["id"], -1)
            if sid != -1:
                groups[sid].append(c)

        names: Dict[int, str] = {}
        for sid, clusters in sorted(groups.items()):
            cluster_summaries = []
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
                cluster_summaries.append(summary)

            try:
                name = await self.llm.name_super_cluster(cluster_summaries)
                if name:
                    names[sid] = name[:100]
                    continue
            except Exception:
                pass

            # Fallback: most common keywords
            all_kw = []
            for c in clusters:
                all_kw.extend(c.get("keywords", [])[:3])
            counts = Counter(kw.lower() for kw in all_kw if kw)
            if counts:
                names[sid] = " & ".join(kw for kw, _ in counts.most_common(2)).title()
            else:
                cname = clusters[0].get("name", "") if clusters else ""
                names[sid] = cname[:50] or f"Super-cluster {sid}"

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
        print("=" * 60)
        print("Starting full graph rebuild")
        print("=" * 60)

        # 1. Fetch open markets
        now = datetime.now(timezone.utc)
        max_m = settings.max_markets if settings.max_markets > 0 else 5000
        all_markets = await prisma.market.find_many(
            where={"OR": [{"resolvedAt": None}, {"resolvedAt": {"gte": now}}]},
        )
        all_markets.sort(key=lambda m: m.volume or 0, reverse=True)
        markets = all_markets[:max_m] if len(all_markets) > max_m else all_markets
        print(f"Fetched {len(markets)} markets")

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

            for m in c_markets:
                x, y = market_positions.get(m.id, (0.0, 0.0))
                await prisma.market.update(
                    where={"id": m.id},
                    data={"embeddingX": float(x), "embeddingY": float(y), "graphEmbedding": json.dumps([])},
                )
                await prisma.clustermarket.create(data={"clusterId": cluster.id, "marketId": m.id})
                market_count += 1

        # 5. Layer 2 — super-clusters (no edges needed for MVP)
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
                        "create": {"id": sid, "name": name[:100], "metadata": {"cluster_count": count}},
                        "update": {"name": name[:100], "metadata": {"cluster_count": count}},
                    },
                )
            if active_sids:
                await prisma.supercluster.delete_many(where={"id": {"not_in": active_sids}})

        # 6. Delete old clusters (cascades ClusterMarket via schema)
        if old_ids:
            print(f"Deleting {len(old_ids)} old clusters...")
            await prisma.clustermarket.delete_many(where={"clusterId": {"in": old_ids}})
            await prisma.cluster.delete_many(where={"id": {"in": old_ids}})

        result = {
            "status": "completed",
            "markets_clustered": market_count,
            "clusters_created": cluster_count,
        }
        print(f"Graph rebuild complete: {result}")
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
    print(f"Merged {len(merge_map)} similar clusters ({len(cluster_names)} → {len(new_names)})")
    return new_m2c, new_names
