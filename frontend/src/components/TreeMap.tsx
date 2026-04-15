import type { ICluster, ISuperCluster } from "@/types";
import { ResponsiveTreeMap } from "@nivo/treemap";

export interface ITreemap {
  superClusters: ISuperCluster[];
  currentPath: string[];
  onNavigate: (path: string[]) => void;
  height?: string;
}

// ─── Nivo datum shape ─────────────────────────────────────────────────────────

interface ITreemapDatum {
  name: string;
  value?: number;
  children?: ITreemapDatum[];
  region?: string;
  description?: string;
  currency?: string;
  growthRate?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clusterVolume(cl: ICluster): number {
  return cl.markets.reduce((sum, m) => sum + m.volume, 0);
}

function superClusterVolume(sc: ISuperCluster): number {
  return sc.clusters.reduce((sum, cl) => sum + clusterVolume(cl), 0);
}

function buildNivoTree(
  superClusters: ISuperCluster[],
  currentPath: string[]
): ITreemapDatum {
  // Depth 0 — mostra super Clusters
  if (currentPath.length === 0) {
    return {
      name: "root",
      children: superClusters.map((sc) => ({
        name: sc.name,
        value: superClusterVolume(sc),
        region: sc.region
      }))
    };
  }

  // Depth 1 — mostra clusters do super cluster selecionado
  if (currentPath.length === 1) {
    const sc = superClusters.find((s) => s.name === currentPath[0])!;
    return {
      name: sc.name,
      children: sc.clusters.map((cl) => ({
        name: cl.name,
        value: clusterVolume(cl),
        description: cl.description
      }))
    };
  }

  // Depth 2 — mostra markets do cluster selecionado
  const sc = superClusters.find((s) => s.name === currentPath[0])!;
  const cl = sc.clusters.find((c) => c.name === currentPath[1])!;
  return {
    name: cl.name,
    children: cl.markets.map((mk) => ({
      name: mk.name,
      value: mk.volume,
      currency: mk.currency,
      region: mk.region,
      growthRate: mk.growthRate
    }))
  };
}

const DEPTH_LABELS = ["Super Clusters", "Clusters", "Markets"];

// ─── Component ────────────────────────────────────────────────────────────────

const TreeMap = ({
  superClusters,
  currentPath,
  onNavigate,
  height = "600px"
}: ITreemap) => {
  const isMaxDepth = currentPath.length >= 2;
  const tree = buildNivoTree(superClusters, currentPath);
  const breadcrumbs = ["All", ...currentPath];

  return (
    <div style={{ height }} className="font-roboto-mono">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 mb-0 mt-5 text-sm select-none px-2">
        {breadcrumbs.map((crumb, i) => {
          const isLast = i === breadcrumbs.length - 1;
          return (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span className="text-gray-400">/</span>}
              <button
                disabled={isLast}
                onClick={() => onNavigate(currentPath.slice(0, i))}
                className={
                  isLast
                    ? "font-semibold text-gray-800 cursor-default"
                    : "text-blue-600 hover:underline cursor-pointer"
                }
              >
                {crumb}
              </button>
            </span>
          );
        })}
        <span className="ml-auto text-xs text-gray-400 italic">
          {DEPTH_LABELS[currentPath.length]}
        </span>
      </div>

      {/* TreeMap */}
      <div
        style={{ height: `calc(${height} - 36px)` }}
        className="font-noto-sans"
      >
        <ResponsiveTreeMap<ITreemapDatum>
          data={tree}
          parentLabelSize={0}
          enableParentLabel={false}
          identity="name"
          value="value"
          valueFormat=">-.2s"
          margin={{ top: 8, right: 8, bottom: 8, left: 8 }}
          labelSkipSize={24}
          label={(node) => `${node.id} · ${node.formattedValue}`}
          labelTextColor={{ from: "color", modifiers: [["darker", 3]] }}
          parentLabelPosition="top"
          parentLabelTextColor={{ from: "color", modifiers: [["darker", 2]] }}
          borderWidth={1}
          borderColor={"black"}
          animate={false}
          motionConfig="gentle"
          tooltip={({ node }) => (
            <div className="bg-white border border-gray-200 shadow rounded px-3 py-2 text-sm space-y-0.5">
              <p className="font-semibold">{node.id}</p>
              <p>
                Volume:{" "}
                <span className="font-medium">
                  {node.value.toLocaleString()}
                </span>
              </p>
              {node.data.region && <p>Region: {node.data.region}</p>}
              {node.data.description && (
                <p className="text-gray-500 italic">{node.data.description}</p>
              )}
              {node.data.currency && <p>Currency: {node.data.currency}</p>}
              {node.data.growthRate !== undefined && (
                <p>Growth: {node.data.growthRate}%</p>
              )}
              {!isMaxDepth && (
                <p className="text-blue-500 text-xs pt-1">
                  Click to drill down →
                </p>
              )}
            </div>
          )}
          onClick={
            isMaxDepth
              ? undefined
              : (node) => onNavigate([...currentPath, node.data.name])
          }
        />
      </div>
    </div>
  );
};

export default TreeMap;
