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
  const [mode, setMode] = useState("controlling"); // controlling | overview
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState(null);
  const [month, setMonth] = useState(dayjs().format("YYYY-MM"));
  const [search, setSearch] = useState("");

  const [activity, setActivity] = useState(null);
  const [fuel, setFuel] = useState(null);
  const [fleetActivity, setFleetActivity] = useState(null);
  const [fleetStatus, setFleetStatus] = useState([]);
  const [exportSelection, setExportSelection] = useState([]);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");

  const [loading, setLoading] = useState(false);
  const [fleetLoading, setFleetLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
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

  const filteredDevices = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return devices;
    return devices.filter((d) => d.name.toLowerCase().includes(term));
  }, [devices, search]);

  useEffect(() => {
    if (!filteredDevices.length) return;
    if (!deviceId || !filteredDevices.find((d) => d.id === deviceId)) {
      setDeviceId(filteredDevices[0].id);
    }
  }, [filteredDevices, deviceId]);

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
     Load fleet activity (for overview KPIs)
     ===================== */
  useEffect(() => {
    setFleetLoading(true);
    apiGet(`/fleet/activity?month=${month}`)
      .then((res) => setFleetActivity(res))
      .then((res) => {
        const ids = (res?.devices || []).map((d) => d.deviceId);
        setExportSelection(ids);
      })
      .catch((e) => {
        console.error(e);
        setError("Flottenübersicht konnte nicht geladen werden");
      })
      .finally(() => setFleetLoading(false));
  }, [month]);

  /* =====================
     Load fleet status (dispatcher view)
     ===================== */
  const refreshStatus = () => {
    setStatusLoading(true);
    apiGet("/fleet/status")
      .then((res) => setFleetStatus(res.devices || []))
      .catch((e) => {
        console.error(e);
        setError("Live-Status konnte nicht geladen werden");
      })
      .finally(() => setStatusLoading(false));
  };

  useEffect(() => {
    if (mode === "overview") {
      refreshStatus();
    }
  }, [mode]);

  /* =====================
     PDF URL
     ===================== */
  const pdfUrl = useMemo(() => {
    if (!deviceId) return "#";
    return `${API_BASE}/reports/activity.pdf?deviceId=${deviceId}&month=${month}`;
  }, [deviceId, month]);

  const handleZipExport = async () => {
    if (!exportSelection.length) {
      setExportError("Bitte mindestens ein Fahrzeug wählen.");
      return;
    }
    setExportError("");
    setExporting(true);
    try {
      const params = new URLSearchParams({ month });
      params.set("deviceIds", exportSelection.join(","));
      const resp = await fetch(`${API_BASE}/reports/activity.zip?${params.toString()}`);
      if (!resp.ok) throw new Error("export_failed");
      const blob = await resp.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Fahrtenbuch_${month}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      setExportError("Export fehlgeschlagen");
    } finally {
      setExporting(false);
    }
  };

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
        {/* Modes */}
        <div style={{ display: "flex", gap: 8 }}>
          {[
            { key: "overview", label: "Übersicht" },
            { key: "controlling", label: "Controlling" }
          ].map((m) => (
            <button
              key={m.key}
              onClick={() => setMode(m.key)}
              style={{
                padding: "8px 12px",
                background: mode === m.key ? "#2563eb" : "#f3f4f6",
                color: mode === m.key ? "#fff" : "#111",
                border: "1px solid #e5e7eb",
                borderRadius: 8,
                fontWeight: mode === m.key ? 700 : 500
              }}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* Device search */}
        <input
          type="text"
          placeholder="Fahrzeug suchen…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: 180 }}
        />

        {/* Device selector */}
        {mode !== "overview" && (
          <select
            value={deviceId || ""}
            onChange={(e) => setDeviceId(Number(e.target.value))}
          >
            {filteredDevices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        )}

        {/* Month picker */}
        <MonthPicker month={month} setMonth={setMonth} />

        {/* ZIP Export (Auswahl) nur im Controlling */}
        {mode === "controlling" && (
          <>
            <a href={pdfUrl} target="_blank" rel="noreferrer">
              <button>PDF Fahrtenbuch (Einzelfahrzeug)</button>
            </a>
            <button onClick={handleZipExport} disabled={exporting}>
              {exporting ? "Export läuft…" : "ZIP Fahrtenbuch (Auswahl)"}
            </button>
          </>
        )}

        {loading && <span style={{ color: "#666" }}>lädt…</span>}
        {fleetLoading && <span style={{ color: "#666" }}>Flotte lädt…</span>}
        {statusLoading && <span style={{ color: "#666" }}>Live lädt…</span>}
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

      {/* ===== Content per Mode ===== */}
      {mode === "overview" && (
        <OverviewView
          month={month}
          fleetActivity={fleetActivity}
          fleetStatus={fleetStatus}
          onRefresh={refreshStatus}
          search={search}
        />
      )}

      {mode === "controlling" && (
        <ControllingView
          month={month}
          activity={activity}
          fuel={fuel}
          fleetActivity={fleetActivity}
          search={search}
          exportSelection={exportSelection}
          setExportSelection={setExportSelection}
          exporting={exporting}
          exportError={exportError}
          onExport={handleZipExport}
          deviceName={filteredDevices.find((d) => d.id === deviceId)?.name || ""}
        />
      )}

      {mode === "fahrzeuge" && (
        <AllVehiclesView
          month={month}
          fleetActivity={fleetActivity}
          fleetStatus={fleetStatus}
          search={search}
          onRefresh={refreshStatus}
        />
      )}

      {/* ===== Footer Info ===== */}
      <div style={{ fontSize: 12, color: "#666" }}>
        QT FleetControl · Datenbasis: Traccar Telemetrie (OBD) ·
        Betriebsfuhrpark (keine Privatnutzung)
      </div>
    </div>
  );
}

function OverviewView({ month, fleetActivity, fleetStatus, onRefresh, search }) {
  const combined = useMemo(() => {
    const activityMap = new Map();
    (fleetActivity?.devices || []).forEach((d) => activityMap.set(d.deviceId, d));
    const term = search.trim().toLowerCase();
    return (fleetStatus || [])
      .map((s) => {
        const activity = activityMap.get(s.deviceId);
        return {
          ...s,
          activeSeconds: activity?.activeSeconds || 0,
          daysActive: activity?.daysActive || 0
        };
      })
      .filter((d) => (term ? d.name.toLowerCase().includes(term) : true))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [fleetStatus, fleetActivity, search]);

  const moving = combined.filter((d) => d.speed >= 5);
  const idle = combined.length - moving.length;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <strong>Flotten-Übersicht</strong>
        <span style={{ color: "#666" }}>Live-Liste + Schnellkalkulation</span>
        <button onClick={onRefresh}>Refresh</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <MetricCard label="Fahrzeuge in Fahrt" value={moving.length} />
        <MetricCard label="Im Stillstand" value={idle} />
        <MetricCard
          label="Ø aktive Stunden/Monat"
          value={
            fleetActivity?.devices?.length
              ? (
                  fleetActivity.devices.reduce((acc, d) => acc + d.activeSeconds, 0) /
                  3600 /
                  fleetActivity.devices.length
                ).toFixed(1)
              : "-"
          }
          hint={`Monat ${month}`}
        />
      </div>

      <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Live-Status & Aktivität (alle)</h3>
          <small style={{ color: "#666" }}>Sortiert nach Name</small>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #eee" }}>
                <th style={{ padding: 6 }}>Fahrzeug</th>
                <th style={{ padding: 6 }}>Status</th>
                <th style={{ padding: 6 }}>Speed</th>
                <th style={{ padding: 6 }}>Tank</th>
                <th style={{ padding: 6 }}>Alarme</th>
                <th style={{ padding: 6 }}>Aktive Std.</th>
                <th style={{ padding: 6 }}>Tage aktiv</th>
                <th style={{ padding: 6 }}>Letzte Meldung</th>
                <th style={{ padding: 6 }}>Ort</th>
              </tr>
            </thead>
            <tbody>
              {combined.map((d) => (
                <tr key={d.deviceId} style={{ borderBottom: "1px solid " + (d.fuelAlert ? "#fecdd3" : "#f3f4f6") }}>
                  <td style={{ padding: 6 }}>{d.name}</td>
                  <td style={{ padding: 6, color: d.speed >= 5 ? "#0f766e" : "#475569" }}>
                    {d.speed >= 5 ? "Fahrt" : "Stand"}
                  </td>
                  <td style={{ padding: 6 }}>{d.speed?.toFixed(1)} km/h</td>
                  <td style={{ padding: 6 }}>{d.fuel !== null ? `${d.fuel}` : "-"}</td>
                  <td style={{ padding: 6 }}>
                    {d.fuelAlert ? (
                      <span style={{ color: "#b91c1c", fontWeight: 700 }}>Tankabfall</span>
                    ) : d.fuelError ? (
                      <span style={{ color: "#d97706" }}>kein Tankwert</span>
                    ) : (
                      <span style={{ color: "#16a34a" }}>OK</span>
                    )}
                  </td>
                  <td style={{ padding: 6, fontVariantNumeric: "tabular-nums" }}>
                    {(d.activeSeconds / 3600).toFixed(1)} h
                  </td>
                  <td style={{ padding: 6 }}>{d.daysActive}</td>
                  <td style={{ padding: 6 }}>
                    {d.lastFix ? new Date(d.lastFix).toLocaleString() : "–"}
                  </td>
                  <td style={{ padding: 6 }}>
                    {d.address ||
                      (d.latitude && d.longitude
                        ? `${d.latitude.toFixed(5)}, ${d.longitude.toFixed(5)}`
                        : "–")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!combined.length && (
            <div style={{ padding: 8, color: "#666" }}>Keine Fahrzeuge gefunden.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function ControllingView({
  month,
  activity,
  fuel,
  fleetActivity,
  search,
  exportSelection,
  setExportSelection,
  exporting,
  exportError,
  onExport,
  deviceName
}) {
  const fleetDevices = useMemo(() => {
    const list = fleetActivity?.devices || [];
    const term = search.trim().toLowerCase();
    if (!term) return list;
    return list.filter((d) => d.name.toLowerCase().includes(term));
  }, [fleetActivity, search]);

  const totalHours = (fleetActivity?.totals?.activeSeconds || 0) / 3600;

  useEffect(() => {
    if (!fleetDevices.length) return;
    // Keep only selections present in filtered devices; if empty, default to all filtered.
    const filteredIds = new Set(fleetDevices.map((d) => d.deviceId));
    const kept = exportSelection.filter((id) => filteredIds.has(id));
    if (kept.length) {
      setExportSelection(kept);
    } else {
      setExportSelection(Array.from(filteredIds));
    }
  }, [fleetDevices, exportSelection]);

  const toggleDevice = (id) => {
    if (exportSelection.includes(id)) {
      setExportSelection(exportSelection.filter((x) => x !== id));
    } else {
      setExportSelection([...exportSelection, id]);
    }
  };

  const toggleAll = () => {
    const allIds = fleetDevices.map((d) => d.deviceId);
    setExportSelection(allIds);
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div
        style={{
          border: "1px solid #eee",
          borderRadius: 12,
          padding: 12,
          background: "#f8fafc"
        }}
      >
        <h3 style={{ marginTop: 0, marginBottom: 8 }}>Flotten-KPIs – {month}</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          <MetricCard label="Gesamt aktive Stunden" value={totalHours.toFixed(1)} />
          <MetricCard
            label="Ø Stunden pro Fahrzeug"
            value={
              fleetDevices.length ? (totalHours / fleetDevices.length).toFixed(1) : "-"
            }
          />
          <MetricCard
            label="Fahrzeuge aktiv"
            value={fleetDevices.filter((d) => d.activeSeconds > 0).length}
          />
        </div>
        <div style={{ marginTop: 12 }}>
          <strong>Top 5 Auslastung</strong>
          <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
            {(fleetActivity?.devices || []).slice(0, 5).map((d) => (
              <div key={d.deviceId} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span>{d.name}</span>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>
                  {(d.activeSeconds / 3600).toFixed(1)} h
                </span>
              </div>
            ))}
            {!fleetActivity?.devices?.length && (
              <div style={{ color: "#666", fontSize: 12 }}>Keine Daten</div>
            )}
          </div>
        </div>
      </div>

      <div
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: 12,
          display: "grid",
          gap: 10,
          background: "#fff"
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Fahrtenbuch Export (ZIP)</h3>
          <button onClick={toggleAll}>Alle auswählen</button>
        </div>
        <div style={{ fontSize: 13, color: "#475569" }}>
          Monat {month} · Generiert ein ZIP mit PDF pro Fahrzeug. Ideal für Buchhaltung (40+ LKW).
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 6 }}>
          {fleetDevices.map((d) => (
            <label key={d.deviceId} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", border: "1px solid #e5e7eb", borderRadius: 10 }}>
              <input
                type="checkbox"
                checked={exportSelection.includes(d.deviceId)}
                onChange={() => toggleDevice(d.deviceId)}
              />
              <div style={{ display: "flex", justifyContent: "space-between", width: "100%", gap: 8 }}>
                <span>{d.name}</span>
                <span style={{ fontVariantNumeric: "tabular-nums", color: "#475569" }}>
                  {(d.activeSeconds / 3600).toFixed(1)} h
                </span>
              </div>
            </label>
          ))}
          {!fleetDevices.length && <div style={{ color: "#666", fontSize: 12 }}>Keine Fahrzeuge</div>}
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button onClick={onExport} disabled={exporting}>
            {exporting ? "Export läuft…" : "ZIP exportieren"}
          </button>
          {exportError && <span style={{ color: "#b91c1c", fontSize: 13 }}>{exportError}</span>}
        </div>
      </div>

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

      <div
        style={{
          border: "1px solid #eee",
          borderRadius: 12,
          padding: 12,
          background: "#fff"
        }}
      >
        <h3 style={{ marginTop: 0 }}>Fahrzeug-Dashboard {deviceName ? `– ${deviceName}` : ""}</h3>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 12
          }}
        >
          <MetricCard
            label="Aktive Stunden (Monat)"
            value={(activity?.days?.reduce((acc, d) => acc + (d.activeSeconds || 0), 0) / 3600 || 0).toFixed(1)}
          />
          <MetricCard
            label="Tage mit Fahrt"
            value={activity?.days?.filter((d) => (d.activeSeconds || 0) > 0).length || 0}
          />
          <MetricCard
            label="Letzter Tankwert"
            value={fuel?.latest ? `${fuel.latest.fuel}` : "–"}
            hint={fuel?.latest ? new Date(fuel.latest.time).toLocaleString() : ""}
          />
          <MetricCard
            label="Tank-Alarme"
            value={fuel?.alerts?.length || 0}
          />
        </div>
      </div>

      <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
        <h3 style={{ marginTop: 0 }}>Flottenübersicht – Stunden/Monat</h3>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #eee" }}>
                <th style={{ padding: 6 }}>Fahrzeug</th>
                <th style={{ padding: 6 }}>Aktive Stunden</th>
                <th style={{ padding: 6 }}>Tage mit Fahrt</th>
              </tr>
            </thead>
            <tbody>
              {fleetDevices.map((d) => (
                <tr key={d.deviceId} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={{ padding: 6 }}>{d.name}</td>
                  <td style={{ padding: 6, fontVariantNumeric: "tabular-nums" }}>
                    {(d.activeSeconds / 3600).toFixed(1)} h
                  </td>
                  <td style={{ padding: 6 }}>{d.daysActive}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!fleetDevices.length && (
            <div style={{ padding: 8, color: "#666" }}>Keine Fahrzeuge gefunden.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, hint }) {
  return (
    <div
      style={{
        border: "1px solid #eee",
        borderRadius: 10,
        padding: 10,
        background: "#fff"
      }}
    >
      <div style={{ fontSize: 12, color: "#666" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
      {hint && <div style={{ fontSize: 12, color: "#94a3b8" }}>{hint}</div>}
    </div>
  );
}
