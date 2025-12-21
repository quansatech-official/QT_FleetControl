import React, { useMemo } from "react";

export default function FuelHistoryChart({ series }) {
  const points = useMemo(() => {
    const all = series || [];
    if (!all.length) return null;
    const maxPoints = 240;
    const step = Math.max(1, Math.floor(all.length / maxPoints));
    const list = all.filter((_, idx) => idx % step === 0);
    if (!list.length) return null;
    const values = all.map((d) => Number(d.fuel)).filter((n) => Number.isFinite(n));
    if (!values.length) return null;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const width = 560;
    const height = 120;
    const padding = 12;
    const step = (width - padding * 2) / (list.length - 1 || 1);
    const coords = list.map((d, i) => {
      const v = Number(d.fuel);
      const y = height - padding - ((v - min) / span) * (height - padding * 2);
      const x = padding + i * step;
      return [x, y];
    });
    return { coords, min, max, width, height, padding };
  }, [series]);

  if (!points) {
    return <div style={{ fontSize: 12, color: "#999" }}>Kein Verlauf verfügbar</div>;
  }

  const path = points.coords
    .map((p, i) => `${i === 0 ? "M" : "L"}${p[0]},${p[1]}`)
    .join(" ");

  return (
    <div style={{ width: "100%" }}>
      <svg viewBox={`0 0 ${points.width} ${points.height}`} width="100%" height="120">
        <defs>
          <linearGradient id="fuelLine" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#0ea5e9" />
            <stop offset="100%" stopColor="#22c55e" />
          </linearGradient>
        </defs>
        <rect
          x="0"
          y="0"
          width={points.width}
          height={points.height}
          fill="#f8fafc"
          rx="8"
        />
        <path d={path} fill="none" stroke="url(#fuelLine)" strokeWidth="2" />
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#64748b" }}>
        <span>Min (Monat): {points.min.toFixed(1)}</span>
        <span>Max (Monat): {points.max.toFixed(1)}</span>
      </div>
    </div>
  );
}
