export const SUPER_CLUSTER_COLORS = [
  "#3B82F6",
  "#22C55E",
  "#FACC15",
  "#A855F7",
  "#EC4899",
  "#14B8A6",
  "#84CC16",
  "#6366F1",
  "#06B6D4",
  "#EAB308",
  "#D946EF",
  "#10B981",
  "#F43F5E",
  "#8B5CF6",
  "#FDE047",
  "#2DD4BF"
] as const;

export const UNDEFINED_COLOR = "#777777";

export function getSuperClusterColor(
  superClusterId: number | null | undefined
): string {
  if (
    superClusterId === null ||
    superClusterId === undefined ||
    superClusterId === -1
  ) {
    return UNDEFINED_COLOR;
  }
  return SUPER_CLUSTER_COLORS[superClusterId % SUPER_CLUSTER_COLORS.length];
}

export function toPastel(hex: string, whiteMix = 0.55): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const pr = Math.round(r + (255 - r) * whiteMix);
  const pg = Math.round(g + (255 - g) * whiteMix);
  const pb = Math.round(b + (255 - b) * whiteMix);
  return `rgb(${pr},${pg},${pb})`;
}
