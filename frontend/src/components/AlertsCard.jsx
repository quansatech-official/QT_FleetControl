import React from "react";

export default function AlertsCard({ alerts }) {
  return (
    <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
      <h3 style={{ marginTop: 0 }}>Alarme</h3>

      {alerts && alerts.length ? (
        <div style={{ display: "grid", gap: 8 }}>
          {alerts.slice(0, 10).map((a, i) => (
            <div
              key={i}
              style={{
                border: "1px solid #f0f0f0",
                borderRadius: 10,
                padding: 8
              }}
            >
              <div style={{ fontWeight: 700 }}>
                {a.type === "refuel" ? "Betankung" : "Tankverlust"}
              </div>
              <div style={{ fontSize: 12, color: "#666" }}>
                {new Date(a.time).toLocaleString()}
              </div>
              <div style={{ fontSize: 12 }}>
                von {a.from} → {a.to} (Δ {Math.round(a.delta * 100) / 100})
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: "#999" }}>
          Keine Alarme im Zeitraum
        </div>
      )}
    </div>
  );
}
