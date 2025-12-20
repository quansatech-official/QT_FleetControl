import React from "react";

export default function FuelCard({ fuel }) {
  return (
    <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
      <h3 style={{ marginTop: 0 }}>Tank</h3>

      {fuel ? (
        <>
          <div style={{ fontSize: 28, fontWeight: 700 }}>
            {fuel.fuel}
          </div>
          <div style={{ fontSize: 12, color: "#666" }}>
            Stand: {new Date(fuel.time).toLocaleString()}
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