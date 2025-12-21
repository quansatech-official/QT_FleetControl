import React from "react";

export default function FuelCard({ fuel }) {
  return (
    <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
      <h3 style={{ marginTop: 0 }}>Tank</h3>

      {fuel ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 80,
                height: 80,
                borderRadius: "50%",
                border: "10px solid #e5e7eb",
                position: "relative",
                boxSizing: "border-box",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: "50%",
                  border: "10px solid #10b981",
                  clipPath: `polygon(0 100%, 0 0, ${Math.min(
                    100,
                    Math.max(0, fuel.fuel)
                  )}% 0, ${Math.min(100, Math.max(0, fuel.fuel))}% 100%)`,
                }}
              />
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "grid",
                  placeItems: "center",
                  fontWeight: 800,
                  fontSize: 18,
                }}
              >
                {fuel.fuel}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{fuel.fuel}</div>
              <div style={{ fontSize: 12, color: "#666" }}>
                Stand: {new Date(fuel.time).toLocaleString()}
              </div>
            </div>
          </div>
        </>
      ) : (
        <div style={{ fontSize: 12, color: "#999" }}>
          Kein Tankwert vorhanden
        </div>
      )}
    </div>
  );
}
