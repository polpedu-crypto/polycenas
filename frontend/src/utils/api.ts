import type {
  ICluster,
  ICorrelationResponse,
  IPaginatedResponse,
  ISuperCluster
} from "@/types";

const BASE_URL = import.meta.env.VITE_API_URL as string;

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(error.detail ?? `Request failed: ${res.status}`);
  }

  return res.json() as Promise<T>;
}

// ─── Super Clusters ───────────────────────────────────────────────────────────

export function getSuperClusters(): Promise<ISuperCluster[]> {
  return request("/superclusters");
}

export function getSuperCluster(id: number): Promise<ISuperCluster> {
  return request(`/superclusters/${id}`);
}

// ─── Clusters ─────────────────────────────────────────────────────────────────

export interface IGetClustersParams {
  supercluster_id?: number;
  search?: string;
  skip?: number;
  limit?: number;
}

export function getClusters(
  params: IGetClustersParams = {}
): Promise<IPaginatedResponse<ICluster>> {
  const query = new URLSearchParams();
  if (params.supercluster_id !== undefined)
    query.set("supercluster_id", String(params.supercluster_id));
  if (params.search) query.set("search", params.search);
  if (params.skip !== undefined) query.set("skip", String(params.skip));
  if (params.limit !== undefined) query.set("limit", String(params.limit));

  const qs = query.toString();
  return request(`/clusters${qs ? `?${qs}` : ""}`);
}

export function getCluster(id: number): Promise<ICluster> {
  return request(`/clusters/${id}`);
}

// ─── Correlation ──────────────────────────────────────────────────────────────

export interface IGetCorrelationParams {
  threshold?: number;
  days_lookback?: number;
  limit_to_top_n?: number;
}

export function getClusterCorrelation(
  clusterId: number,
  params: IGetCorrelationParams = {}
): Promise<ICorrelationResponse> {
  const query = new URLSearchParams();
  if (params.threshold !== undefined)
    query.set("threshold", String(params.threshold));
  if (params.days_lookback !== undefined)
    query.set("days_lookback", String(params.days_lookback));
  if (params.limit_to_top_n !== undefined)
    query.set("limit_to_top_n", String(params.limit_to_top_n));

  const qs = query.toString();
  return request(`/clusters/${clusterId}/correlation${qs ? `?${qs}` : ""}`);
}
