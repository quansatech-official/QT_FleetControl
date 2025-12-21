import express from "express";
import cors from "cors";
import archiver from "archiver";
import dayjs from "dayjs";

import { createPoolFromEnv } from "./db.js";
import { computeDailyActivity } from "./activity.js";
import { extractFuelValue, detectFuelDrops } from "./fuel.js";
import { renderPdfFromHtml } from "./pdf.js";

const SECONDS_DAY = 24 * 3600;

const app = express();
app.use(cors());
app.use(express.json());

const pool = createPoolFromEnv();
const tablePrefix = process.env.DB_PREFIX || "";
const tbl = (name) => `${tablePrefix}${name}`;

/* =======================
   Konfiguration (ENV)
   ======================= */
const cfg = {
  minSpeedKmh: Number(process.env.MIN_SPEED_KMH || 5),
  stopToleranceSec: Number(process.env.STOP_TOLERANCE_SEC || 120),
  minMovingSeconds: Number(process.env.MIN_MOVING_SECONDS || 60),

  fuelKeys: (process.env.FUEL_JSON_KEY || "fuel,fuel.level,io48")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean),
  fuelDropLiters: Number(process.env.FUEL_DROP_LITERS || 10),
  fuelDropPercent: Number(process.env.FUEL_DROP_PERCENT || 8),
  fuelWindowMinutes: Number(process.env.FUEL_WINDOW_MINUTES || 10),
  geocodeUrl: process.env.GEOCODE_URL || "https://nominatim.openstreetmap.org/reverse",
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
      `SELECT id, name, uniqueid FROM ${tbl("devices")} WHERE disabled = 0 ORDER BY name`
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
       FROM ${tbl("positions")}
       WHERE deviceid = ? AND fixtime >= ? AND fixtime < ?
       ORDER BY fixtime ASC`,
      [deviceId, start.toDate(), end.toDate()]
    );

    const { secondsByDay, segmentsByDay } = computeDailyActivity(rows, cfg);

    // Alle Tage des Monats auffüllen
    const daysInMonth = end.subtract(1, "day").date();
    const days = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const day = start.date(d).format("YYYY-MM-DD");
      const segments = segmentsByDay.get(day) || [];
      days.push({
        day,
        activeSeconds: secondsByDay.get(day) || 0,
        segments
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
       FROM ${tbl("positions")}
       WHERE deviceid = ? AND fixtime >= ? AND fixtime < ?
       ORDER BY fixtime ASC`,
      [deviceId, start.toDate(), end.toDate()]
    );

    // Downsample: 1 Wert pro Minute (letzter Wert pro Minute)
    const byMinute = new Map();
    for (const r of rows) {
      const fuel = extractFuelValue(r.attributes, cfg.fuelKeys);
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
   Fleet – Monatsaktivität (Übersicht für viele Geräte)
   ======================= */
app.get("/api/fleet/activity", async (req, res) => {
  const month = String(req.query.month || dayjs().format("YYYY-MM")); // YYYY-MM
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: "month required (YYYY-MM)" });
  }

  try {
    const start = dayjs(`${month}-01`).startOf("month");
    const end = start.add(1, "month");

    const [rows] = await pool.query(
      `SELECT d.id AS deviceId, d.name, p.fixtime, p.speed
       FROM ${tbl("devices")} d
       LEFT JOIN ${tbl("positions")} p
         ON p.deviceid = d.id AND p.fixtime >= ? AND p.fixtime < ?
       WHERE d.disabled = 0
       ORDER BY d.id, p.fixtime`,
      [start.toDate(), end.toDate()]
    );

    const byDevice = new Map();
    for (const r of rows) {
      if (!byDevice.has(r.deviceId)) {
        byDevice.set(r.deviceId, { name: r.name, rows: [] });
      }
      if (r.fixtime) {
        byDevice.get(r.deviceId).rows.push({ fixtime: r.fixtime, speed: r.speed });
      }
    }

    let totalSeconds = 0;
    const devices = [];

    for (const [deviceId, info] of byDevice.entries()) {
      const { secondsByDay } = computeDailyActivity(info.rows, cfg);
      let activeSeconds = 0;
      let daysActive = 0;
      for (const sec of secondsByDay.values()) {
        activeSeconds += sec;
        if (sec > 0) daysActive += 1;
      }
      totalSeconds += activeSeconds;
      devices.push({
        deviceId,
        name: info.name,
        activeSeconds,
        daysActive
      });
    }

    devices.sort((a, b) => b.activeSeconds - a.activeSeconds);

    res.json({
      month,
      devices,
      totals: {
        activeSeconds: totalSeconds
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "fleet_activity_failed" });
  }
});

/* =======================
   Fleet – Aktueller Status (Dispatcher)
   ======================= */
app.get("/api/fleet/status", async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT d.id AS deviceId, d.name, p.fixtime, p.latitude, p.longitude, p.speed, p.attributes, p.address
       FROM ${tbl("devices")} d
       LEFT JOIN (
         SELECT p1.*
         FROM ${tbl("positions")} p1
         JOIN (
           SELECT deviceid, MAX(fixtime) AS maxFix
           FROM ${tbl("positions")}
           GROUP BY deviceid
         ) latest
         ON latest.deviceid = p1.deviceid AND latest.maxFix = p1.fixtime
       ) p ON p.deviceid = d.id
       WHERE d.disabled = 0
       ORDER BY d.name`
    );

    const devices = [];

    for (const r of rows) {
      let fuel = null;
      try {
        fuel = extractFuelValue(r.attributes, cfg.fuelKeys);
      } catch {
        fuel = null;
      }

      // Detect recent fuel drop on a small window for alerting
      let fuelAlert = null;
      try {
        const [recentRows] = await pool.query(
          `SELECT fixtime, attributes
           FROM ${tbl("positions")}
           WHERE deviceid = ?
           ORDER BY fixtime DESC
           LIMIT 120`,
          [r.deviceId]
        );
        const series = recentRows
          .map((p) => ({
            time: p.fixtime,
            fuel: extractFuelValue(p.attributes, cfg.fuelKeys)
          }))
          .filter((p) => p.fuel !== null)
          .sort((a, b) => a.time.localeCompare(b.time));
        const alerts = detectFuelDrops(series, {
          dropLiters: cfg.fuelDropLiters,
          dropPercent: cfg.fuelDropPercent,
          windowMinutes: cfg.fuelWindowMinutes
        });
        if (alerts.length) fuelAlert = alerts[alerts.length - 1];
      } catch (err) {
        console.error("fuel_alert_detect_failed", err);
      }

      const resolvedAddress = await resolveAddress(r.address, r.latitude, r.longitude);

      devices.push({
        deviceId: r.deviceId,
        name: r.name,
        lastFix: r.fixtime,
        latitude: r.latitude,
        longitude: r.longitude,
        address: resolvedAddress,
        speed: Number(r.speed || 0),
        fuel,
        fuelAlert,
        fuelError: fuel === null
      });
    }

    res.json({ devices });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "fleet_status_failed" });
  }
});

const geocodeCache = new Map(); // key -> { value, expires }

function normalizeAddress(addr) {
  if (!addr) return null;
  try {
    if (typeof addr === "string") {
      const trimmed = addr.trim();
      if (!trimmed) return null;
      if (trimmed.startsWith("{")) {
        const parsed = JSON.parse(trimmed);
        const parts = [
          parsed.road || parsed.street,
          parsed.house_number,
          parsed.postcode,
          parsed.city || parsed.town || parsed.village,
        ].filter(Boolean);
        if (parts.length) return parts.join(", ");
      }
      return trimmed;
    } else if (typeof addr === "object") {
      const parts = [
        addr.road || addr.street,
        addr.house_number,
        addr.postcode,
        addr.city || addr.town || addr.village,
      ].filter(Boolean);
      if (parts.length) return parts.join(", ");
    }
  } catch {
    return null;
  }
  return null;
}

async function reverseGeocode(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  const cached = geocodeCache.get(key);
  const now = Date.now();
  if (cached && cached.expires > now) return cached.value;

  try {
    const url = `${cfg.geocodeUrl}?format=jsonv2&lat=${lat}&lon=${lon}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    const r = await fetch(url, {
      headers: {
        "User-Agent": "QT-FleetControl/1.0 (fleet)",
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!r.ok) throw new Error(`geocode_failed_${r.status}`);
    const data = await r.json();
    const addr = data.address || {};
    const parts = [
      addr.road || addr.pedestrian || addr.cycleway || addr.footway,
      addr.house_number,
      addr.postcode,
      addr.city || addr.town || addr.village,
    ].filter(Boolean);
    const resolved = parts.length ? parts.join(", ") : data.display_name || null;
    if (resolved) {
      geocodeCache.set(key, { value: resolved, expires: now + 24 * 3600 * 1000 });
      return resolved;
    }
  } catch (err) {
    console.error("reverse_geocode_failed", err);
  }
  return null;
}

async function resolveAddress(addr, lat, lon) {
  const normalized = normalizeAddress(addr);
  if (normalized) return normalized;
  const geo = await reverseGeocode(lat, lon);
  if (geo) return geo;
  if (Number.isFinite(lat) && Number.isFinite(lon)) return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  return "Adresse fehlt";
}

async function buildActivityReport(deviceId, month) {
  const start = dayjs(`${month}-01`).startOf("month");
  const end = start.add(1, "month");

  const [[device]] = await pool.query(
    `SELECT id, name FROM ${tbl("devices")} WHERE id = ?`,
    [deviceId]
  );

  if (!device) throw new Error("device_not_found");

  const [rows] = await pool.query(
    `SELECT fixtime, speed, latitude, longitude, address
     FROM ${tbl("positions")}
     WHERE deviceid = ? AND fixtime >= ? AND fixtime < ?
     ORDER BY fixtime ASC`,
    [deviceId, start.toDate(), end.toDate()]
  );

  const { secondsByDay, segmentsByDay } = computeDailyActivity(rows, cfg);

  const daysInMonth = end.subtract(1, "day").date();
  let totalSeconds = 0;
  let totalDistanceKm = 0;
  let rowsHtml = "";

  const findNearestPosition = (dayRows, targetIso) => {
    if (!dayRows.length) return null;
    let best = null;
    let bestDiff = Number.MAX_VALUE;
    const target = dayjs(targetIso);
    for (const r of dayRows) {
      const diff = Math.abs(dayjs(r.fixtime).diff(target, "second"));
      if (diff < bestDiff) {
        bestDiff = diff;
        best = r;
      }
    }
    return best;
  };

  const distanceKm = (a, b) => {
    if (
      !Number.isFinite(a?.latitude) ||
      !Number.isFinite(a?.longitude) ||
      !Number.isFinite(b?.latitude) ||
      !Number.isFinite(b?.longitude)
    ) return 0;
    const R = 6371; // km
    const toRad = (x) => (x * Math.PI) / 180;
    const dLat = toRad(b.latitude - a.latitude);
    const dLon = toRad(b.longitude - a.longitude);
    const lat1 = toRad(a.latitude);
    const lat2 = toRad(b.latitude);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    return R * c;
  };

  for (let d = 1; d <= daysInMonth; d++) {
    const day = start.date(d).format("YYYY-MM-DD");
    const sec = secondsByDay.get(day) || 0;
    totalSeconds += sec;
    const hours = (sec / 3600).toFixed(2);
    const width = Math.min(100, (sec / 86400) * 100);

    const dayRows = rows.filter((r) => dayjs(r.fixtime).format("YYYY-MM-DD") === day);
    const segments = segmentsByDay.get(day) || [];

    // Start/End nach echter Fahrt (erstes/letztes Sample über Threshold)
    const movingRows = dayRows.filter((r) => Number(r.speed) >= cfg.minSpeedKmh);
    const startTimeIso = movingRows.length ? dayjs(movingRows[0].fixtime).toISOString() : null;
    const endTimeIso = movingRows.length ? dayjs(movingRows[movingRows.length - 1].fixtime).toISOString() : null;

    const startPos = startTimeIso ? findNearestPosition(dayRows, startTimeIso) : null;
    const endPos = endTimeIso ? findNearestPosition(dayRows, endTimeIso) : null;

    const startAddress = startPos
      ? await resolveAddress(startPos.address, startPos.latitude, startPos.longitude)
      : "-";
    const endAddress = endPos
      ? await resolveAddress(endPos.address, endPos.latitude, endPos.longitude)
      : "-";

    // Distanz pro Tag (ungefähr, Haversine zwischen Positionspunkten)
    let dayDistance = 0;
    for (let i = 1; i < dayRows.length; i++) {
      dayDistance += distanceKm(dayRows[i - 1], dayRows[i]);
    }
    totalDistanceKm += dayDistance;

    const timeline = segments
      .map((s) => {
        const left = (s.start / SECONDS_DAY) * 100;
        const width = ((s.end - s.start) / SECONDS_DAY) * 100;
        return `<span style="position:absolute; left:${left}%; width:${width}%; top:0; bottom:0; background:#2563eb;"></span>`;
      })
      .join("");

    rowsHtml += `<tr>
      <td>${day}</td>
      <td>${startTimeIso ? dayjs(startTimeIso).format("HH:mm") : "-"}</td>
      <td>${startAddress}</td>
      <td>${endTimeIso ? dayjs(endTimeIso).format("HH:mm") : "-"}</td>
      <td>${endAddress}</td>
      <td style="text-align:right; font-variant-numeric: tabular-nums;">${dayDistance.toFixed(1)} km</td>
      <td style="text-align:right; font-variant-numeric: tabular-nums;">${hours}</td>
      <td>
        <div style="position:relative; height:22px; background:#f1f5f9; border:1px solid #e2e8f0; border-radius:10px; overflow:hidden;">
          ${timeline || ""}
        </div>
      </td>
    </tr>`;
  }

  const totalHours = (totalSeconds / 3600).toFixed(2);
  const totalDistanceStr = totalDistanceKm.toFixed(1);

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
    th, td { border-bottom:1px solid #eee; padding:6px 4px; vertical-align:middle; }
    th { background:#fafafa; text-align:left; }
    .right { text-align:right; }
    .footer { margin-top:12px; color:#666; font-size:10px; }
  </style>
</head>
<body>
  <h1>QT FleetControl – Fahrtenbuch Monatsreport</h1>
  <div class="meta">
    <span class="badge">Fahrzeug: ${device?.name || deviceId}</span>
    <span class="badge">Monat: ${month}</span>
    <span class="badge">Gültig: Fahrtenbuch AT</span>
  </div>

  <table>
    <thead>
      <tr>
        <th>Tag</th>
        <th>Start (Zeit)</th>
        <th>Start (Ort)</th>
        <th>Ende (Zeit)</th>
        <th>Ende (Ort)</th>
        <th class="right">Distanz (km)</th>
        <th class="right">Aktive Zeit (h)</th>
        <th>Balken</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
    <tfoot>
      <tr>
        <th>Summe</th>
        <th></th>
        <th></th>
        <th></th>
        <th></th>
        <th class="right">${totalDistanceStr}</th>
        <th class="right">${totalHours}</th>
        <th></th>
      </tr>
    </tfoot>
  </table>

  <div class="footer">
    Messbasis: Traccar Telemetrie (OBD). Österreich-konformes Fahrtenbuch (Monatsansicht) – Start/Ende je Tag, aktive Zeit.<br/>
    Parameter: minSpeed=${cfg.minSpeedKmh} km/h,
    stopTolerance=${cfg.stopToleranceSec}s,
    minBlock=${cfg.minMovingSeconds}s
  </div>
</body>
</html>
`;

  const pdf = await renderPdfFromHtml(html);
  const filename = `QT_FleetControl_Activity_${device?.name || deviceId}_${month}.pdf`.replace(
    /\s+/g,
    "_"
  );
  return { pdf, filename };
}

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
    const { pdf, filename } = await buildActivityReport(deviceId, month);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${filename}"`
    );
    res.end(pdf);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "pdf_failed" });
  }
});

/* =======================
   ZIP – Activity Monat (Bulk Export)
   ======================= */
app.get("/api/reports/activity.zip", async (req, res) => {
  const month = String(req.query.month || dayjs().format("YYYY-MM"));
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: "month required (YYYY-MM)" });
  }

  let deviceIds = String(req.query.deviceIds || "")
    .split(",")
    .map((id) => Number(id))
    .filter((n) => Number.isFinite(n));

  try {
    if (!deviceIds.length) {
      const [rows] = await pool.query(
        `SELECT id FROM ${tbl("devices")} WHERE disabled = 0 ORDER BY name`
      );
      deviceIds = rows.map((r) => r.id);
    }

    if (!deviceIds.length) {
      return res.status(400).json({ error: "no_devices" });
    }

    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="QT_FleetControl_Activity_${month}.zip"`
    );

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", (err) => {
      console.error(err);
      res.status(500).end();
    });
    archive.pipe(res);

    for (const id of deviceIds) {
      try {
        const { pdf, filename } = await buildActivityReport(id, month);
        archive.append(pdf, { name: filename });
      } catch (err) {
        console.error(`bulk_pdf_failed device=${id}`, err);
      }
    }

    archive.finalize();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "bulk_pdf_failed" });
  }
});

/* =======================
   Server Start
   ======================= */
const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log(`QT FleetControl API listening on :${PORT}`);
});
