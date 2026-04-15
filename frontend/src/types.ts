// ─── Shared ───────────────────────────────────────────────────────────────────

export interface ITopMarket {
  id: number;
  title: string;
  volume: number;
}

export interface IMarket {
  id: number;
  title: string;
  event_title: string;
  volume: number;
  category: string;
}

// ─── Cluster ──────────────────────────────────────────────────────────────────

export interface ICluster {
  id: number;
  name: string;
  keywords: string[];
  total_volume: number;
  market_count: number;
  top_market: ITopMarket;
  markets?: IMarket[];
  supercluster_id?: number;
  centroid?: { x: number; y: number };
  category?: string;
  description?: string;
}

// ─── Super Cluster ────────────────────────────────────────────────────────────

export interface ISuperCluster {
  id: number;
  name: string;
  metadata: { cluster_count: number };
  total_volume: number;
  cluster_count: number;
  market_count: number;
  clusters: ICluster[];
  region?: string;
}

// ─── Pagination ───────────────────────────────────────────────────────────────

export interface IPagination {
  skip: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

export interface IPaginatedResponse<T> {
  data: T[];
  pagination: IPagination;
}

// ─── Correlation ──────────────────────────────────────────────────────────────

export interface ICorrelationPair {
  market_a_id: number;
  market_b_id: number;
  r_value: number;
  r_squared: number;
}

export interface ISignificantPair {
  market_a_id: number;
  market_a_title: string;
  market_a_event: string;
  market_b_id: number;
  market_b_title: string;
  market_b_event: string;
  r_value: number;
  r_squared: number;
  correlation_type: "positive" | "negative";
}

export interface ICorrelationMarketMeta {
  title: string;
  polymarketId: string;
  eventTitle: string;
}

export interface ICorrelationResponse {
  matrix: ICorrelationPair[];
  markets: Record<string, ICorrelationMarketMeta>;
  significant_pairs: ISignificantPair[];
  data_points: number;
  date_range: { start: string; end: string };
  threshold: number;
  cluster_name: string;
  analyzed_at: string;
}
