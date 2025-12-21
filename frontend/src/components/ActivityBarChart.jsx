import React, { useMemo } from "react";

const SECONDS_DAY = 24 * 3600;
const TIME_MARKERS = [0, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24];

// Simple per-day timeline: blue segments for Fahrzeit, gaps for Stillstand.
export default function ActivityBarChart({ data }) {
  const timeMarkers = useMemo(
    () =>
      TIME_MARKERS.map((h) => ({
        hour: h,
        left: (h / 24) * 100,
        label: String(h).padStart(2, "0"),
      })),
    []
  );

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
        <div style={{ position: "relative", height: 18 }}>
          {timeMarkers.map((m) => (
            <span
              key={m.hour}
              style={{
                position: "absolute",
                left: `${m.left}%`,
                transform:
                  m.hour === 0
                    ? "translateX(0)"
                    : m.hour === 24
                    ? "translateX(-100%)"
                    : "translateX(-50%)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {m.label}
            </span>
          ))}
        </div>
        <span style={{ textAlign: "right" }}>Uhr</span>
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
            {timeMarkers.map((m) => (
              <div
                key={m.hour}
                style={{
                  position: "absolute",
                  left: `${m.left}%`,
                  top: 0,
                  bottom: 0,
                  width: 1,
                  background: "#e5e7eb",
                }}
              />
            ))}
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
