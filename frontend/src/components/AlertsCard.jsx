import React from "react";

export default function AlertsCard({ alerts }) {
  return (
    <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
      <h3 style={{ marginTop: 0 }}>Ereignisse</h3>

      {alerts && alerts.length ? (
        <div style={{ display: "grid", gap: 8 }}>
          {alerts.slice(0, 10).map((a, i) => {
            const isDrop = a.type !== "refuel";
            const bg = isDrop ? "#fef2f2" : "#f0fdf4";
            const border = isDrop ? "#fecaca" : "#bbf7d0";
            const badge = isDrop ? "!" : "+";
            const label = isDrop ? "Tankverlust" : "Betankung";
            return (
              <div
                key={i}
                style={{
                  border: `1px solid ${border}`,
                  borderRadius: 10,
                  padding: 8,
                  background: bg,
                  display: "grid",
                  gap: 4
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: "50%",
                      display: "grid",
                      placeItems: "center",
                      background: isDrop ? "#dc2626" : "#16a34a",
                      color: "#fff",
                      fontWeight: 800,
                      fontSize: 12
                    }}
                  >
                    {badge}
                  </span>
                  <div style={{ fontWeight: 700 }}>{label}</div>
                </div>
                <div style={{ fontSize: 12, color: "#666" }}>
                  {new Date(a.time).toLocaleString()}
                </div>
                <div style={{ fontSize: 12 }}>
                  von {a.from} → {a.to} (Δ {Math.round(a.delta * 100) / 100})
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: "#999" }}>
          Keine Alarme im Zeitraum
        </div>
      )}
    </div>
  );
}
