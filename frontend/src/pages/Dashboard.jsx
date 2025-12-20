import React, { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";

import { apiGet, API_BASE } from "../api.js";
import MonthPicker from "../components/MonthPicker.jsx";
import ActivityBarChart from "../components/ActivityBarChart.jsx";
import FuelCard from "../components/FuelCard.jsx";
import AlertsCard from "../components/AlertsCard.jsx";

export default function Dashboard() {
  /* =====================
     State
     ===================== */
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState(null);
  const [month, setMonth] = useState(dayjs().format("YYYY-MM"));

  const [activity, setActivity] = useState(null);
  const [fuel, setFuel] = useState(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  /* =====================
     Load devices
     ===================== */
  useEffect(() => {
    apiGet("/devices")
      .then((d) => {
        setDevices(d || []);
        if (d && d.length) setDeviceId(d[0].id);
      })
      .catch((e) => {
        console.error(e);
        setError("Geräte konnten nicht geladen werden");
      });
  }, []);

  /* =====================
     Load data (activity + fuel)
     ===================== */
  useEffect(() => {
    if (!deviceId) return;

    setLoading(true);
    setError(null);

    Promise.all([
      apiGet(`/activity/month?deviceId=${deviceId}&month=${month}`),
      apiGet(`/fuel/month?deviceId=${deviceId}&month=${month}`)
    ])
      .then(([activityRes, fuelRes]) => {
        setActivity(activityRes);
        setFuel(fuelRes);
      })
      .catch((e) => {
        console.error(e);
        setError("Daten konnten nicht geladen werden");
      })
      .finally(() => setLoading(false));
  }, [deviceId, month]);

  /* =====================
     PDF URL
     ===================== */
  const pdfUrl = useMemo(() => {
    if (!deviceId) return "#";
    return `${API_BASE}/reports/activity.pdf?deviceId=${deviceId}&month=${month}`;
  }, [deviceId, month]);

  /* =====================
     Render
     ===================== */
  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* ===== Toolbar ===== */}
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap"
        }}
      >
        {/* Device selector */}
        <select
          value={deviceId || ""}
          onChange={(e) => setDeviceId(Number(e.target.value))}
        >
          {devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>

        {/* Month picker */}
        <MonthPicker month={month} setMonth={setMonth} />

        {/* PDF Export */}
        <a href={pdfUrl} target="_blank" rel="noreferrer">
          <button>PDF Monatsreport</button>
        </a>

        {loading && <span style={{ color: "#666" }}>lädt…</span>}
      </div>

      {/* ===== Errors ===== */}
      {error && (
        <div
          style={{
            background: "#fff3f3",
            border: "1px solid #ffd1d1",
            padding: 12,
            borderRadius: 10,
            color: "#a40000"
          }}
        >
          {error}
        </div>
      )}

      {/* ===== Main Grid ===== */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "2fr 1fr",
          gap: 16
        }}
      >
        {/* Activity */}
        <div
          style={{
            border: "1px solid #eee",
            borderRadius: 12,
            padding: 12
          }}
        >
          <h3 style={{ marginTop: 0 }}>
            Aktive Fahrzeit – {month}
          </h3>

          <ActivityBarChart data={activity?.days || []} />
        </div>

        {/* Side cards */}
        <div style={{ display: "grid", gap: 16 }}>
          <FuelCard fuel={fuel?.latest || null} />
          <AlertsCard alerts={fuel?.alerts || []} />
        </div>
      </div>

      {/* ===== Footer Info ===== */}
      <div style={{ fontSize: 12, color: "#666" }}>
        QT FleetControl · Datenbasis: Traccar Telemetrie (OBD) ·
        Betriebsfuhrpark (keine Privatnutzung)
      </div>
    </div>
  );
}