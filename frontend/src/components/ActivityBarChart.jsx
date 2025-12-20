import React, { useMemo } from "react";

const SECONDS_DAY = 24 * 3600;

// Simple per-day timeline: blue segments for Fahrzeit, gaps for Stillstand.
export default function ActivityBarChart({ data }) {
  const days = useMemo(
    () =>
      (data || []).map((d) => ({
        label: d.day.slice(-2),
        hours: Math.round((d.activeSeconds / 3600) * 100) / 100,
        segments: (d.segments || [])
          .map((s) => ({
            start: Math.max(0, Math.min(SECONDS_DAY, Number(s.start))),
            end: Math.max(0, Math.min(SECONDS_DAY, Number(s.end))),
          }))
          .filter((s) => s.end > s.start)
          .sort((a, b) => a.start - b.start),
      })),
    [data]
  );

  if (!days.length) {
    return <div style={{ color: "#666" }}>Keine Daten</div>;
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {/* Time markers */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "48px 1fr 64px",
          fontSize: 12,
          color: "#666",
          alignItems: "center",
        }}
      >
        <span />
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>00</span>
          <span>12</span>
          <span>24</span>
        </div>
        <span style={{ textAlign: "right" }}>h</span>
      </div>

      {days.map((d) => (
        <div
          key={d.label}
          style={{
            display: "grid",
            gridTemplateColumns: "48px 1fr 64px",
            gap: 8,
            alignItems: "center",
          }}
        >
          <div style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
            {d.label}.
          </div>

          <div
            style={{
              position: "relative",
              height: 16,
              background: "#f3f4f6",
              borderRadius: 10,
              overflow: "hidden",
              border: "1px solid #e5e7eb",
            }}
          >
            {d.segments.map((s, idx) => {
              const left = (s.start / SECONDS_DAY) * 100;
              const width = ((s.end - s.start) / SECONDS_DAY) * 100;
              return (
                <div
                  key={idx}
                  style={{
                    position: "absolute",
                    left: `${left}%`,
                    width: `${width}%`,
                    top: 0,
                    bottom: 0,
                    background: "#2563eb",
                  }}
                />
              );
            })}
          </div>

          <div
            style={{
              textAlign: "right",
              fontVariantNumeric: "tabular-nums",
              color: "#333",
            }}
          >
            {d.hours.toFixed(2)} h
          </div>
        </div>
      ))}
    </div>
  );
}
