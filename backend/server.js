import express from "express";
import cors from "cors";
import dayjs from "dayjs";

import { createPoolFromEnv } from "./db.js";
import { computeDailyActiveSeconds } from "./activity.js";
import { extractFuelValue, detectFuelDrops } from "./fuel.js";
import { renderPdfFromHtml } from "./pdf.js";

const app = express();
app.use(cors());
app.use(express.json());

const pool = createPoolFromEnv();

/* =======================
   Konfiguration (ENV)
   ======================= */
const cfg = {
  minSpeedKmh: Number(process.env.MIN_SPEED_KMH || 5),
  stopToleranceSec: Number(process.env.STOP_TOLERANCE_SEC || 120),
  minMovingSeconds: Number(process.env.MIN_MOVING_SECONDS || 60),

  fuelKey: process.env.FUEL_JSON_KEY || "fuel",
  fuelDropLiters: Number(process.env.FUEL_DROP_LITERS || 10),
  fuelDropPercent: Number(process.env.FUEL_DROP_PERCENT || 8),
  fuelWindowMinutes: Number(process.env.FUEL_WINDOW_MINUTES || 10),
};

/* =======================
   Health
   ======================= */
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "QT FleetControl API" });
});

/* =======================
   Devices
   ======================= */
app.get("/api/devices", async (_req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, name, uniqueid FROM devices WHERE disabled = 0 ORDER BY name"
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "devices_failed" });
  }
});

/* =======================
   Activity – Monat (Balken)
   ======================= */
app.get("/api/activity/month", async (req, res) => {
  const deviceId = Number(req.query.deviceId);
  const month = String(req.query.month || dayjs().format("YYYY-MM")); // YYYY-MM

  if (!deviceId || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: "deviceId & month required (YYYY-MM)" });
  }

  try {
    const start = dayjs(`${month}-01`).startOf("month");
    const end = start.add(1, "month");

    const [rows] = await pool.query(
      `SELECT fixtime, speed
       FROM positions
       WHERE deviceid = ? AND fixtime >= ? AND fixtime < ?
       ORDER BY fixtime ASC`,
      [deviceId, start.toDate(), end.toDate()]
    );

    const dailyMap = computeDailyActiveSeconds(rows, cfg);

    // Alle Tage des Monats auffüllen
    const daysInMonth = end.subtract(1, "day").date();
    const days = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const day = start.date(d).format("YYYY-MM-DD");
      days.push({
        day,
        activeSeconds: dailyMap.get(day) || 0
      });
    }

    res.json({ deviceId, month, days });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "activity_failed" });
  }
});

/* =======================
   Fuel – Monat (Serie + Alarm)
   ======================= */
app.get("/api/fuel/month", async (req, res) => {
  const deviceId = Number(req.query.deviceId);
  const month = String(req.query.month || dayjs().format("YYYY-MM"));

  if (!deviceId || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: "deviceId & month required (YYYY-MM)" });
  }

  try {
    const start = dayjs(`${month}-01`).startOf("month");
    const end = start.add(1, "month");

    const [rows] = await pool.query(
      `SELECT fixtime, attributes
       FROM positions
       WHERE deviceid = ? AND fixtime >= ? AND fixtime < ?
       ORDER BY fixtime ASC`,
      [deviceId, start.toDate(), end.toDate()]
    );

    // Downsample: 1 Wert pro Minute (letzter Wert pro Minute)
    const byMinute = new Map();
    for (const r of rows) {
      const fuel = extractFuelValue(r.attributes, cfg.fuelKey);
      if (fuel === null) continue;
      const key = dayjs(r.fixtime).format("YYYY-MM-DD HH:mm");
      byMinute.set(key, {
        time: dayjs(r.fixtime).toISOString(),
        fuel
      });
    }

    const series = Array.from(byMinute.values())
      .sort((a, b) => a.time.localeCompare(b.time));

    const latest = series.length ? series[series.length - 1] : null;

    const alerts = detectFuelDrops(series, {
      dropLiters: cfg.fuelDropLiters,
      dropPercent: cfg.fuelDropPercent,
      windowMinutes: cfg.fuelWindowMinutes
    });

    res.json({ deviceId, month, latest, series, alerts });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "fuel_failed" });
  }
});

/* =======================
   PDF – Activity Monat
   ======================= */
app.get("/api/reports/activity.pdf", async (req, res) => {
  const deviceId = Number(req.query.deviceId);
  const month = String(req.query.month || dayjs().format("YYYY-MM"));

  if (!deviceId || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: "deviceId & month required (YYYY-MM)" });
  }

  try {
    const start = dayjs(`${month}-01`).startOf("month");
    const end = start.add(1, "month");

    const [[device]] = await pool.query(
      "SELECT id, name FROM devices WHERE id = ?",
      [deviceId]
    );

    const [rows] = await pool.query(
      `SELECT fixtime, speed
       FROM positions
       WHERE deviceid = ? AND fixtime >= ? AND fixtime < ?
       ORDER BY fixtime ASC`,
      [deviceId, start.toDate(), end.toDate()]
    );

    const dailyMap = computeDailyActiveSeconds(rows, cfg);

    const daysInMonth = end.subtract(1, "day").date();
    let totalSeconds = 0;
    let rowsHtml = "";

    for (let d = 1; d <= daysInMonth; d++) {
      const day = start.date(d).format("YYYY-MM-DD");
      const sec = dailyMap.get(day) || 0;
      totalSeconds += sec;
      const hours = (sec / 3600).toFixed(2);
      rowsHtml += `<tr><td>${day}</td><td style="text-align:right">${hours}</td></tr>`;
    }

    const totalHours = (totalSeconds / 3600).toFixed(2);

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <style>
    body { font-family: Arial, sans-serif; font-size: 12px; }
    h1 { font-size: 18px; margin: 0 0 8px; }
    .meta { margin-bottom: 12px; }
    .badge { display:inline-block; padding:4px 8px; border:1px solid #ddd; border-radius:999px; margin-right:6px; }
    table { width:100%; border-collapse: collapse; }
    th, td { border-bottom:1px solid #eee; padding:6px 4px; }
    th { background:#fafafa; text-align:left; }
    .right { text-align:right; }
    .footer { margin-top:12px; color:#666; font-size:10px; }
  </style>
</head>
<body>
  <h1>QT FleetControl – Activity Report</h1>
  <div class="meta">
    <span class="badge">Fahrzeug: ${device?.name || deviceId}</span>
    <span class="badge">Monat: ${month}</span>
  </div>

  <table>
    <thead>
      <tr><th>Tag</th><th class="right">Aktive Zeit (h)</th></tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
    <tfoot>
      <tr><th>Summe</th><th class="right">${totalHours}</th></tr>
    </tfoot>
  </table>

  <div class="footer">
    Messbasis: Traccar Telemetrie (OBD).<br/>
    Parameter: minSpeed=${cfg.minSpeedKmh} km/h,
    stopTolerance=${cfg.stopToleranceSec}s,
    minBlock=${cfg.minMovingSeconds}s
  </div>
</body>
</html>
`;

    const pdf = await renderPdfFromHtml(html);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="QT_FleetControl_Activity_${deviceId}_${month}.pdf"`
    );
    res.end(pdf);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "pdf_failed" });
  }
});

/* =======================
   Server Start
   ======================= */
const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log(`QT FleetControl API listening on :${PORT}`);
});