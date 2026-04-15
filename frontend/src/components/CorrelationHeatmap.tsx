import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getClusterCorrelation } from "@/utils/api";
import type { ICorrelationResponse } from "@/types";

interface ICorrelationHeatmap {
  clusterId: number | null;
  loading?: boolean;
}

interface ITooltipState {
  r: number;
  aTitle: string;
  bTitle: string;
  x: number;
  y: number;
}

function rToColor(r: number): string {
  const c = Math.max(-1, Math.min(1, r));
  if (c >= 0) {
    const i = Math.round(c * 200);
    return `rgb(255,${255 - i},${255 - i})`;
  }
  const i = Math.round(-c * 200);
  return `rgb(${255 - i},${255 - i},255)`;
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

const FONT = "var(--font-roboto-mono, monospace)";
const LABEL_WIDTH = 120;
const TOP_LABEL_HEIGHT = 120;
const FONT_SIZE = 10;
const LABEL_MAX = 20;

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function HeatmapSkeleton() {
  const n = 5;
  return (
    <div className="flex flex-col gap-2">
      <div className="h-9 w-56 bg-gray-200 animate-pulse " />
      <div className="h-4 w-40 bg-gray-100 animate-pulse " />
      <div className="aspect-square w-full">
        <div
          className="w-full h-full grid animate-pulse"
          style={{
            gridTemplateColumns: `120px repeat(${n}, 1fr)`,
            gridTemplateRows: `120px repeat(${n}, 1fr)`
          }}
        >
          {/* top-left empty */}
          <div className="bg-white" />
          {/* top labels */}
          {Array.from({ length: n }).map((_, i) => (
            <div key={`tl-${i}`} className="flex items-end justify-center pb-2">
              <div
                className="h-16 w-3 bg-gray-200 "
                style={{ animationDelay: `${i * 60}ms` }}
              />
            </div>
          ))}
          {/* rows */}
          {Array.from({ length: n }).map((_, yi) => (
            <>
              {/* left label */}
              <div
                key={`ll-${yi}`}
                className="flex items-center justify-end pr-2"
              >
                <div className="h-3 w-16 bg-gray-200 " />
              </div>
              {/* cells */}
              {Array.from({ length: n }).map((_, xi) => (
                <div
                  key={`cell-${xi}-${yi}`}
                  className="bg-gray-100 border border-white"
                  style={{ opacity: 0.4 + Math.random() * 0.6 }}
                />
              ))}
            </>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── SVG heatmap ──────────────────────────────────────────────────────────────

interface IHeatmapProps {
  data: ICorrelationResponse;
  width: number;
  height: number;
}

const HeatmapSVG = ({ data, width, height }: IHeatmapProps) => {
  const [tooltip, setTooltip] = useState<ITooltipState | null>(null);

  const marketIds = Object.keys(data.markets).map(Number);
  const n = marketIds.length;
  if (n < 2)
    return (
      <p className="text-sm text-gray-400 font-roboto-mono">
        Not enough markets with price history.
      </p>
    );

  const gridW = width - LABEL_WIDTH;
  const gridH = height - TOP_LABEL_HEIGHT;
  const cellW = gridW / n;
  const cellH = gridH / n;

  const rMatrix: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) rMatrix[i][i] = 1;
  data.matrix.forEach((pair) => {
    const xi = marketIds.indexOf(pair.market_a_id);
    const yi = marketIds.indexOf(pair.market_b_id);
    if (xi === -1 || yi === -1) return;
    rMatrix[xi][yi] = pair.r_value;
    rMatrix[yi][xi] = pair.r_value;
  });

  const labels = marketIds.map((id) =>
    truncate(data.markets[id]?.title ?? String(id), LABEL_MAX)
  );

  return (
    <>
      <svg
        width={width}
        height={height}
        style={{ fontFamily: FONT, fontSize: FONT_SIZE, display: "block" }}
        onMouseLeave={() => setTooltip(null)}
      >
        {labels.map((label, i) => (
          <text
            key={`top-${i}`}
            x={LABEL_WIDTH + i * cellW + cellW / 2}
            y={TOP_LABEL_HEIGHT - 6}
            textAnchor="start"
            fill="#444"
            fontSize={FONT_SIZE}
            transform={`rotate(-45, ${LABEL_WIDTH + i * cellW + cellW / 2}, ${TOP_LABEL_HEIGHT - 6})`}
          >
            {label}
          </text>
        ))}

        {labels.map((label, i) => (
          <text
            key={`left-${i}`}
            x={LABEL_WIDTH - 6}
            y={TOP_LABEL_HEIGHT + i * cellH + cellH / 2}
            textAnchor="end"
            dominantBaseline="middle"
            fill="#444"
            fontSize={FONT_SIZE}
          >
            {label}
          </text>
        ))}

        {rMatrix.map((row, yi) =>
          row.map((r, xi) => (
            <rect
              key={`${xi}-${yi}`}
              x={LABEL_WIDTH + xi * cellW}
              y={TOP_LABEL_HEIGHT + yi * cellH}
              width={cellW}
              height={cellH}
              fill={rToColor(r)}
              stroke="white"
              strokeWidth={1}
              shapeRendering="crispEdges"
              style={{ cursor: "crosshair" }}
              onMouseEnter={(e) =>
                setTooltip({
                  r,
                  aTitle:
                    data.markets[marketIds[xi]]?.title ?? String(marketIds[xi]),
                  bTitle:
                    data.markets[marketIds[yi]]?.title ?? String(marketIds[yi]),
                  x: e.clientX,
                  y: e.clientY
                })
              }
              onMouseMove={(e) =>
                setTooltip((prev) =>
                  prev ? { ...prev, x: e.clientX, y: e.clientY } : null
                )
              }
            />
          ))
        )}

        {cellW > 36 &&
          cellH > 20 &&
          rMatrix.map((row, yi) =>
            row.map((r, xi) => (
              <text
                key={`val-${xi}-${yi}`}
                x={LABEL_WIDTH + xi * cellW + cellW / 2}
                y={TOP_LABEL_HEIGHT + yi * cellH + cellH / 2}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={Math.min(FONT_SIZE, cellH * 0.38)}
                fill={Math.abs(r) > 0.55 ? "white" : "#333"}
                style={{ pointerEvents: "none", userSelect: "none" }}
              >
                {r.toFixed(2)}
              </text>
            ))
          )}
      </svg>

      {tooltip &&
        createPortal(
          <div
            style={{
              position: "fixed",
              left: tooltip.x + 14,
              top: tooltip.y - 20,
              zIndex: 9999,
              fontFamily: FONT,
              pointerEvents: "none"
            }}
            className="bg-white border border-black px-3 py-2 min-w-[180px] max-w-[260px]"
          >
            <p className="text-xs font-bold tracking-widest text-gray-400 mb-1">
              CORRELATION
            </p>
            <p
              className="font-merriweather font-bold mb-2"
              style={{ fontSize: 28 }}
            >
              {tooltip.r.toFixed(3)}
            </p>
            <div className="flex flex-col gap-1">
              <div className="text-xs">
                <span className="text-gray-500">A </span>
                <span>{truncate(tooltip.aTitle, 36)}</span>
              </div>
              <div className="text-xs">
                <span className="text-gray-500">B </span>
                <span>{truncate(tooltip.bTitle, 36)}</span>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
};

// ─── Component ────────────────────────────────────────────────────────────────

const CorrelationHeatmap = ({
  clusterId,
  loading: parentLoading
}: ICorrelationHeatmap) => {
  const [data, setData] = useState<ICorrelationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (clusterId === null) {
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    getClusterCorrelation(clusterId)
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [clusterId]);

  if (parentLoading || loading) return <HeatmapSkeleton />;

  if (error)
    return <div className="text-sm text-red-500 font-roboto-mono">{error}</div>;

  return (
    <div className="flex flex-col gap-2">
      <h2 className="font-merriweather text-3xl font-thin">
        Correlations Heatmap
      </h2>
      {data && (
        <p className="text-xs text-gray-400 font-roboto-mono">
          {data.cluster_name} · {Object.keys(data.markets).length} markets · r ≥{" "}
          {data.threshold}
        </p>
      )}
      <div className="aspect-square w-full">
        {data ? (
          <HeatmapSVG data={data} width={500} height={500} />
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-gray-400 font-roboto-mono">
            Select a cluster to view correlations
          </div>
        )}
      </div>
    </div>
  );
};

export default CorrelationHeatmap;
