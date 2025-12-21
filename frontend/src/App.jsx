import React from "react";
import Dashboard from "./pages/Dashboard.jsx";
import logo from "../QTIT.png";

export default function App() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #0f172a, #111827 35%, #0b1225)",
        color: "#0f172a",
        padding: "24px 16px",
        boxSizing: "border-box"
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          background: "#fff",
          borderRadius: 16,
          boxShadow: "0 24px 60px rgba(0,0,0,0.18)",
          overflow: "hidden",
          border: "1px solid #e5e7eb"
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "14px 18px",
            background: "linear-gradient(90deg, #0ea5e9, #2563eb)",
          color: "#fff"
        }}
      >
        <img
          src={logo}
          alt="Quansatech GmbH"
          style={{
            width: 44,
            height: 44,
            objectFit: "contain",
            borderRadius: 12,
            background: "rgba(255,255,255,0.14)",
            border: "1px solid rgba(255,255,255,0.25)",
            padding: 4
          }}
        />
          <div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>Quansatech GmbH · FleetControl</div>
            <div style={{ fontSize: 12, opacity: 0.9 }}>
              Fleet Analytics Dashboard – Live, Controlling & Werkstatt
            </div>
          </div>
        </header>

        <main style={{ padding: 16 }}>
          <Dashboard />
        </main>
      </div>
    </div>
  );
}
