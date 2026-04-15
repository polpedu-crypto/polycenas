import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import type { ICluster, ISuperCluster } from "@/types";
import { ResponsiveTreeMap } from "@nivo/treemap";
import type { ComputedNode } from "@nivo/treemap";
import {
  getSuperClusterColor,
  toPastel,
  UNDEFINED_COLOR
} from "@/utils/colors";
import { formatHumanReadable } from "@/utils/numbers";

export interface ITreemap {
  superClusters: ISuperCluster[];
  selectedCluster: ICluster | null;
  clusterLoading: boolean;
  currentPath: string[];
  onNavigate: (path: string[]) => void;
  height?: string;
}

interface ITreemapDatum {
  name: string;
  rawValue?: number;
  value?: number;
  children?: ITreemapDatum[];
  market_count?: number;
  cluster_count?: number;
  keywords?: string[];
  top_market_title?: string;
  event_title?: string;
  category?: string;
  superClusterIdx?: number;
  isOthers?: boolean;
  othersCount?: number;
}

function scaleValue(v: number): number {
  return Math.sqrt(v);
}

const MAX_VISIBLE = 18;

function groupWithOthers(
  items: ITreemapDatum[],
  showAll: boolean
): ITreemapDatum[] {
  if (showAll || items.length <= MAX_VISIBLE) return items;
  const sorted = [...items].sort(
    (a, b) => (b.rawValue ?? 0) - (a.rawValue ?? 0)
  );
  const top = sorted.slice(0, MAX_VISIBLE);
  const rest = sorted.slice(MAX_VISIBLE);
  const othersRaw = rest.reduce((s, i) => s + (i.rawValue ?? 0), 0);
  return [
    ...top,
    {
      name: "Others",
      rawValue: othersRaw,
      value: scaleValue(othersRaw),
      isOthers: true,
      othersCount: rest.length
    }
  ];
}

function buildNivoTree(
  superClusters: ISuperCluster[],
  selectedCluster: ICluster | null,
  currentPath: string[],
  showAll: boolean
): ITreemapDatum {
  if (currentPath.length === 0) {
    return {
      name: "root",
      children: groupWithOthers(
        superClusters.map((sc, idx) => ({
          name: sc.name,
          rawValue: sc.total_volume,
          value: scaleValue(sc.total_volume),
          market_count: sc.market_count,
          cluster_count: sc.cluster_count,
          superClusterIdx: idx
        })),
        showAll
      )
    };
  }

  if (currentPath.length === 1) {
    const sc = superClusters.find((s) => s.name === currentPath[0]);
    if (!sc) return { name: "root", children: [] };
    return {
      name: sc.name,
      children: groupWithOthers(
        sc.clusters.map((cl) => ({
          name: cl.name,
          rawValue: cl.total_volume,
          value: scaleValue(cl.total_volume),
          market_count: cl.market_count,
          keywords: cl.keywords,
          top_market_title: cl.top_market?.title,
          superClusterIdx: superClusters.indexOf(sc)
        })),
        showAll
      )
    };
  }

  if (!selectedCluster?.markets) return { name: "root", children: [] };
  const sc = superClusters.find((s) => s.name === currentPath[0]);
  const scIdx = sc ? superClusters.indexOf(sc) : undefined;
  return {
    name: selectedCluster.name,
    children: groupWithOthers(
      selectedCluster.markets.map((mk) => ({
        name: mk.title,
        rawValue: mk.volume,
        value: scaleValue(mk.volume),
        event_title: mk.event_title,
        category: mk.category,
        superClusterIdx: scIdx
      })),
      showAll
    )
  };
}

function resolveColor(datum: ITreemapDatum): string {
  if (datum.isOthers) return "#e8e8e8";
  const base =
    datum.superClusterIdx !== undefined
      ? getSuperClusterColor(datum.superClusterIdx)
      : UNDEFINED_COLOR;
  return toPastel(base, 0.72);
}

const FONT_FAMILY = "var(--font-roboto-mono, monospace)";
const TYPE_FONT_SIZE = 9;
const FONT_SIZE = 12;
const CHAR_WIDTH = 7.2;
const PADDING = 8;
const LINE_HEIGHT = 16;
const TYPE_GAP = 4;
const DEPTH_TYPE = ["SUPERCLUSTER", "CLUSTER", "MARKET"] as const;

function splitToLines(text: string, maxChars: number): [string, string | null] {
  if (text.length <= maxChars) return [text, null];
  const sub = text.slice(0, maxChars);
  const spaceIdx = sub.lastIndexOf(" ");
  let line1: string, rest: string;
  if (spaceIdx > maxChars * 0.4) {
    line1 = sub.slice(0, spaceIdx);
    rest = text.slice(spaceIdx + 1);
  } else {
    line1 = sub;
    rest = text.slice(maxChars);
  }
  const line2 =
    rest.length <= maxChars ? rest : rest.slice(0, maxChars - 1) + "…";
  return [line1, line2];
}

// ─── Module-level refs ────────────────────────────────────────────────────────

const _refs = {
  navigate: (_p: string[]) => {},
  path: [] as string[],
  isMaxDepth: false,
  depth: 0 as number,
  setShowAll: (_v: boolean) => {}
};

// ─── Node tooltip ─────────────────────────────────────────────────────────────

interface INodeTooltipProps {
  data: ITreemapDatum;
  id: string;
  x: number;
  y: number;
}

function NodeTooltip({ data: d, id, x, y }: INodeTooltipProps) {
  return createPortal(
    <div
      style={{
        position: "fixed",
        left: x + 14,
        top: y - 20,
        zIndex: 9999,
        fontFamily: FONT_FAMILY,
        pointerEvents: "none"
      }}
      className="bg-white border border-black px-3 py-2 min-w-[180px] max-w-[260px]"
    >
      <p className="text-xs font-bold tracking-widest text-gray-400 mb-0.5">
        {d.isOthers ? "OTHERS" : (DEPTH_TYPE[_refs.depth] ?? "")}
      </p>
      <p className="text-xs font-semibold mb-1 leading-tight">{id}</p>
      {d.rawValue !== undefined && (
        <p className="font-merriweather text-2xl font-bold mb-1">
          {formatHumanReadable(d.rawValue)}
        </p>
      )}
      <div className="flex flex-col gap-0.5 mt-1">
        {d.cluster_count !== undefined && (
          <div className="flex justify-between gap-4 text-xs">
            <span className="text-gray-500">Clusters</span>
            <span>{d.cluster_count}</span>
          </div>
        )}
        {d.market_count !== undefined && (
          <div className="flex justify-between gap-4 text-xs">
            <span className="text-gray-500">Markets</span>
            <span>{d.market_count}</span>
          </div>
        )}
        {d.keywords?.length ? (
          <div className="flex justify-between gap-4 text-xs">
            <span className="text-gray-500">Keywords</span>
            <span className="text-right">{d.keywords.join(", ")}</span>
          </div>
        ) : null}
        {d.top_market_title && (
          <div className="flex justify-between gap-4 text-xs">
            <span className="text-gray-500">Top</span>
            <span className="text-right">{d.top_market_title}</span>
          </div>
        )}
        {d.event_title && (
          <div className="flex justify-between gap-4 text-xs">
            <span className="text-gray-500">Event</span>
            <span className="text-right">{d.event_title}</span>
          </div>
        )}
        {d.category && (
          <div className="flex justify-between gap-4 text-xs">
            <span className="text-gray-500">Category</span>
            <span>{d.category}</span>
          </div>
        )}
        {d.isOthers && d.othersCount && (
          <div className="flex justify-between gap-4 text-xs">
            <span className="text-gray-500">Hidden</span>
            <span>{d.othersCount} items</span>
          </div>
        )}
      </div>
      {d.isOthers ? (
        <p className="text-blue-500 text-xs mt-1.5 border-t border-gray-200 pt-1">
          Click to show all →
        </p>
      ) : !_refs.isMaxDepth ? (
        <p className="text-blue-500 text-xs mt-1.5 border-t border-gray-200 pt-1">
          Click to drill down →
        </p>
      ) : null}
    </div>,
    document.body
  );
}

// ─── Node component ───────────────────────────────────────────────────────────

interface INodeProps {
  node: ComputedNode<ITreemapDatum>;
  isInteractive: boolean;
  onHover?: (node: ComputedNode<ITreemapDatum>, e: React.MouseEvent) => void;
  onLeave?: (node: ComputedNode<ITreemapDatum>, e: React.MouseEvent) => void;
  onClick?: (node: ComputedNode<ITreemapDatum>, e: React.MouseEvent) => void;
}

function NodeComponent({ node, isInteractive }: INodeProps) {
  const [hovered, setHovered] = useState(false);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const { x, y, width, height, data } = node;
  const label = String(node.id);

  if (label === "root") return null;

  const baseColor = resolveColor(data);
  const fill = hovered ? "#374151" : baseColor;
  const textColor = hovered ? "#ffffff" : "rgba(0,0,0,0.82)";
  const typeColor = hovered ? "rgba(255,255,255,0.65)" : "rgba(0,0,0,0.45)";
  const typeLabel = data.isOthers ? "" : (DEPTH_TYPE[_refs.depth] ?? "");
  const nameText = data.isOthers
    ? `Others (+${data.othersCount ?? ""})`
    : label;

  const maxChars = Math.floor((width - PADDING * 2) / CHAR_WIDTH);
  const hasRoomForType = height >= 52 && width >= 40;
  const hasRoomForText = maxChars >= 4 && height >= 28 && width >= 40;

  const typeY = PADDING + TYPE_FONT_SIZE;
  const line1Y =
    hasRoomForType && typeLabel
      ? typeY + TYPE_GAP + FONT_SIZE
      : PADDING + FONT_SIZE;
  const line2Y = line1Y + LINE_HEIGHT;
  const [line1, line2] = hasRoomForText
    ? splitToLines(nameText, maxChars)
    : [null, null];

  return (
    <>
      <g
        transform={`translate(${x},${y})`}
        style={{ cursor: isInteractive ? "pointer" : "default" }}
        onMouseEnter={(e) => {
          setHovered(true);
          setMousePos({ x: e.clientX, y: e.clientY });
        }}
        onMouseMove={(e) => setMousePos({ x: e.clientX, y: e.clientY })}
        onMouseLeave={() => setHovered(false)}
        onClick={() => {
          if (data.isOthers) {
            _refs.setShowAll(true);
            return;
          }
          if (_refs.isMaxDepth) return;
          _refs.navigate([..._refs.path, label]);
        }}
      >
        <rect
          width={width}
          height={height}
          fill={fill}
          stroke="black"
          strokeWidth={1}
          shapeRendering="crispEdges"
        />
        {hasRoomForType && typeLabel && (
          <text
            x={PADDING}
            y={typeY}
            fontSize={TYPE_FONT_SIZE}
            fill={typeColor}
            style={{
              fontFamily: FONT_FAMILY,
              userSelect: "none",
              pointerEvents: "none",
              fontWeight: 700,
              letterSpacing: "0.08em"
            }}
          >
            {typeLabel}
          </text>
        )}
        {line1 && (
          <text
            x={PADDING}
            y={line1Y}
            fontSize={FONT_SIZE}
            fill={textColor}
            style={{
              fontFamily: FONT_FAMILY,
              userSelect: "none",
              pointerEvents: "none"
            }}
          >
            {line1}
          </text>
        )}
        {line2 && (
          <text
            x={PADDING}
            y={line2Y}
            fontSize={FONT_SIZE}
            fill={textColor}
            style={{
              fontFamily: FONT_FAMILY,
              userSelect: "none",
              pointerEvents: "none"
            }}
          >
            {line2}
          </text>
        )}
      </g>
      {hovered && (
        <NodeTooltip data={data} id={label} x={mousePos.x} y={mousePos.y} />
      )}
    </>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function TreeMapSkeleton({ height }: { height: string }) {
  return (
    <div style={{ height }} className="flex flex-col gap-2 p-2 mt-5">
      <div className="h-5 w-48 bg-gray-200 animate-pulse " />
      <div className="flex-1 grid grid-cols-3 grid-rows-2 gap-1">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="bg-gray-200 animate-pulse "
            style={{ animationDelay: `${i * 80}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEPTH_LABELS = ["Super Clusters", "Clusters", "Markets"];

// ─── Component ────────────────────────────────────────────────────────────────

const TreeMap = ({
  superClusters,
  selectedCluster,
  clusterLoading,
  currentPath,
  onNavigate,
  height = "600px"
}: ITreemap) => {
  const [showAll, setShowAll] = useState(false);
  const isMaxDepth = currentPath.length >= 2;

  useEffect(() => {
    setShowAll(false);
  }, [currentPath]);

  _refs.navigate = onNavigate;
  _refs.path = currentPath;
  _refs.isMaxDepth = isMaxDepth;
  _refs.depth = currentPath.length;
  _refs.setShowAll = setShowAll;

  const tree = buildNivoTree(
    superClusters,
    selectedCluster,
    currentPath,
    showAll
  );
  const breadcrumbs = ["All", ...currentPath, ...(showAll ? ["Others"] : [])];

  if (clusterLoading) return <TreeMapSkeleton height={height} />;

  return (
    <div style={{ height }}>
      <div className="flex items-center gap-1 mb-0 mt-5 text-sm select-none px-2 font-roboto-mono">
        {breadcrumbs.map((crumb, i) => {
          const isOthersEntry = crumb === "Others";
          const isLast = i === breadcrumbs.length - 1;
          return (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span className="text-gray-400">/</span>}
              <button
                disabled={isLast}
                onClick={() => {
                  if (isOthersEntry) {
                    setShowAll(false);
                    return;
                  }
                  setShowAll(false);
                  onNavigate(currentPath.slice(0, i));
                }}
                className={
                  isLast
                    ? "font-semibold text-gray-800 cursor-default"
                    : isOthersEntry
                      ? "text-orange-500 hover:underline cursor-pointer"
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

      <div style={{ height: `calc(${height} - 36px)` }}>
        <ResponsiveTreeMap<ITreemapDatum>
          data={tree}
          identity="name"
          value="value"
          margin={{ top: 8, right: 8, bottom: 8, left: 8 }}
          enableParentLabel={false}
          animate={false}
          isInteractive={false}
          nodeComponent={NodeComponent as never}
        />
      </div>
    </div>
  );
};

export default TreeMap;
