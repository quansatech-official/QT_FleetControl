import express from "express";
import cors from "cors";
import archiver from "archiver";
import dayjs from "dayjs";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

import { createPoolFromEnv } from "./db.js";
import { computeDailyActivity } from "./activity.js";
import { extractFuelValue, detectFuelDrops, detectFuelRefuels } from "./fuel.js";
import { renderPdfFromHtml } from "./pdf.js";

const SECONDS_DAY = 24 * 3600;
const DEFAULT_TANK_CAPACITY_LITERS = Number(process.env.TANK_CAPACITY_LITERS || 400);
const DEFAULT_AVG_L_PER_100KM = Number(process.env.AVG_CONSUMPTION_L_PER_100KM || 30);

function distanceKm(a, b) {
  if (
    !Number.isFinite(a?.latitude) ||
    !Number.isFinite(a?.longitude) ||
    !Number.isFinite(b?.latitude) ||
    !Number.isFinite(b?.longitude)
  ) return 0;
  const R = 6371;
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
}

const app = express();
app.use(cors());
app.use(express.json());

const pool = createPoolFromEnv();
const tablePrefix = process.env.DB_PREFIX || "";
const tbl = (name) => `${tablePrefix}${name}`;

/* =======================
   Konfiguration (ENV)
   ======================= */
const defaultFuelKeys = [
  "fuel",
  "fuel.level",
  "fuelLevel",
  "fuelUsed",
  "fuelConsumption",
  "io48",
  "io[48]",
  "attributes.io48",
  "attributes['io48']",
];

const cfg = {
  minSpeedKmh: Number(process.env.MIN_SPEED_KMH || 5),
  stopToleranceSec: Number(process.env.STOP_TOLERANCE_SEC || 120),
  minMovingSeconds: Number(process.env.MIN_MOVING_SECONDS || 60),
  minStopSeconds: Number(process.env.MIN_STOP_SECONDS || 600),
  dashboardStopToleranceSec: Number(process.env.DASHBOARD_STOP_TOLERANCE_SEC || 60),
  dashboardMinMovingSeconds: Number(process.env.DASHBOARD_MIN_MOVING_SECONDS || 30),
  dashboardMinStopSeconds: Number(process.env.DASHBOARD_MIN_STOP_SECONDS || 180),
  detailGapSeconds: Number(process.env.DETAIL_GAP_SECONDS || 600), // Segmente enger als dieser Wert werden im Detailreport zusammengelegt
  detailStopSeconds: Number(process.env.DETAIL_STOP_SECONDS || process.env.MIN_STOP_SECONDS || 600),
  detailMinSegmentSeconds: Number(process.env.DETAIL_MIN_SEGMENT_SECONDS || 180),
  detailMinSegmentDistanceM: Number(process.env.DETAIL_MIN_SEGMENT_DISTANCE_M || 200),
  detailMinStartEndDistanceM: Number(process.env.DETAIL_MIN_START_END_DISTANCE_M || 150),
  detailMergeStopSeconds: Number(process.env.DETAIL_MERGE_STOP_SECONDS || 300),
  pdfGeocode: String(process.env.PDF_GEOCODE || "").toLowerCase() === "true",
  distanceMaxSpeedKmh: Number(process.env.DIST_MAX_SPEED_KMH || 160),

  fuelKeys: Array.from(
    new Set(
      ((process.env.FUEL_JSON_KEY || "").split(",") || [])
        .map((k) => k.trim())
        .filter(Boolean)
        .concat(defaultFuelKeys)
    )
  ),
  fuelDropLiters: Number(process.env.FUEL_DROP_LITERS || 10),
  fuelDropPercent: Number(process.env.FUEL_DROP_PERCENT || 8),
  fuelWindowMinutes: Number(process.env.FUEL_WINDOW_MINUTES || 10),
  refuelLiters: Number(process.env.FUEL_REFUEL_LITERS || 15),
  refuelPercent: Number(process.env.FUEL_REFUEL_PERCENT || 10),
  tankCapacityLiters: DEFAULT_TANK_CAPACITY_LITERS,
  avgConsumptionLPer100Km: DEFAULT_AVG_L_PER_100KM,
  geocodeUrl: process.env.GEOCODE_URL || "https://nominatim.openstreetmap.org/reverse",
  geocodeConcurrency: Number(process.env.GEOCODE_CONCURRENCY || 4),
};

/* =======================
   Auth (Traccar)
   ======================= */
const JWT_SECRET = process.env.JWT_SECRET || "dev_only_change_me";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "12h";
const TRACCAR_BASE_URL = process.env.TRACCAR_BASE_URL || "";
const TRACCAR_AUTH_MODE =
  process.env.TRACCAR_AUTH_MODE || (TRACCAR_BASE_URL ? "api" : "db");
const AUTH_DISABLED = String(process.env.AUTH_DISABLED || "").toLowerCase() === "true";

if (JWT_SECRET === "dev_only_change_me") {
  console.warn("JWT_SECRET not set. Using insecure default.");
}

function getTokenFromReq(req, allowQueryToken) {
  const auth = req.headers.authorization || "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  if (allowQueryToken && typeof req.query?.token === "string" && req.query.token.trim()) {
    return req.query.token.trim();
  }
  return "";
}

function authRequired({ allowQueryToken = false } = {}) {
  return (req, res, next) => {
    if (req.method === "OPTIONS") return res.sendStatus(204);
    if (AUTH_DISABLED) {
      req.user = { id: 0, name: "debug", administrator: true };
      return next();
    }
    const token = getTokenFromReq(req, allowQueryToken);
    if (!token) return res.status(401).json({ error: "unauthorized" });
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      req.user = payload;
      return next();
    } catch {
      return res.status(401).json({ error: "unauthorized" });
    }
  };
}

function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      name: user.name || null,
      email: user.email || null,
      administrator: !!user.administrator
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

async function authenticateWithTraccarApi(identifier, password) {
  if (!TRACCAR_BASE_URL) return null;
  const url = `${TRACCAR_BASE_URL.replace(/\/$/, "")}/api/session`;
  const payload = { email: identifier, password };

  const tryRequest = async (headers, body) => {
    const resp = await fetch(url, {
      method: "POST",
      headers,
      body
    });
    if (!resp.ok) return null;
    const data = await resp.json().catch(() => null);
    return data || null;
  };

  // Try JSON, then form-encoded for older Traccar servers
  let data = await tryRequest(
    { "Content-Type": "application/json" },
    JSON.stringify(payload)
  );
  if (!data) {
    const params = new URLSearchParams(payload);
    data = await tryRequest(
      { "Content-Type": "application/x-www-form-urlencoded" },
      params.toString()
    );
  }

  if (!data || data.disabled) return null;
  return {
    id: data.id,
    name: data.name,
    email: data.email,
    administrator: !!data.administrator
  };
}

async function authenticateWithTraccarDb(identifier, password) {
  const [rows] = await pool.query(
    `SELECT * FROM ${tbl("users")} WHERE (email = ? OR name = ?) LIMIT 1`,
    [identifier, identifier]
  );
  const user = rows?.[0];
  if (!user || user.disabled) return null;

  const hash = user.password || user.hashedpassword || user.hashedPassword || "";
  if (!hash || typeof hash !== "string") {
    return { error: "unsupported_hash" };
  }

  const ok = await bcrypt.compare(password, hash);
  if (!ok) return null;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    administrator: !!(user.administrator ?? user.admin ?? user.isadmin)
  };
}

async function resolveEmailFromDb(identifier) {
  const [rows] = await pool.query(
    `SELECT email FROM ${tbl("users")} WHERE (email = ? OR name = ?) LIMIT 1`,
    [identifier, identifier]
  );
  return rows?.[0]?.email || null;
}

async function authenticateTraccarUser(identifier, password) {
  if (TRACCAR_AUTH_MODE === "api") {
    let apiIdentifier = identifier;
    if (!identifier.includes("@")) {
      const resolved = await resolveEmailFromDb(identifier);
      if (resolved) apiIdentifier = resolved;
    }
    const apiUser = await authenticateWithTraccarApi(apiIdentifier, password);
    if (apiUser) return apiUser;
  }
  if (TRACCAR_AUTH_MODE === "db" || !TRACCAR_BASE_URL) {
    return authenticateWithTraccarDb(identifier, password);
  }
  return null;
}

async function requireDeviceAccess(user, deviceId) {
  if (!user || user.administrator) return true;
  const [rows] = await pool.query(
    `SELECT 1 FROM ${tbl("user_device")} WHERE userid = ? AND deviceid = ? LIMIT 1`,
    [user.id, deviceId]
  );
  return rows.length > 0;
}

/* =======================
   Health
   ======================= */
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "QT FleetControl API" });
});

/* =======================
   Auth
   ======================= */
app.post("/api/login", async (req, res) => {
  if (AUTH_DISABLED) {
    const user = { id: 0, name: "debug", email: null, administrator: true };
    const token = signToken(user);
    return res.json({ token, user });
  }
  const identifier = String(req.body?.identifier || "").trim();
  const password = String(req.body?.password || "");
  if (!identifier || !password) {
    return res.status(400).json({ error: "identifier_password_required" });
  }

  try {
    const user = await authenticateTraccarUser(identifier, password);
    if (!user) return res.status(401).json({ error: "invalid_credentials" });
    if (user?.error === "unsupported_hash") {
      return res.status(401).json({ error: "unsupported_hash" });
    }

    const token = signToken(user);
    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        administrator: !!user.administrator
      }
    });
  } catch (err) {
    console.error("login_failed", err);
    res.status(500).json({ error: "login_failed" });
  }
});

app.get("/api/me", authRequired(), (req, res) => {
  res.json({ user: req.user });
});

app.use("/api", (req, res, next) => {
  const allowQueryToken = req.path.startsWith("/reports/");
  return authRequired({ allowQueryToken })(req, res, next);
});

/* =======================
   Devices
   ======================= */
app.get("/api/devices", async (_req, res) => {
  try {
    const user = _req.user;
    let rows;
    if (user?.administrator) {
      [rows] = await pool.query(
        `SELECT id, name, uniqueid FROM ${tbl("devices")} WHERE disabled = 0 ORDER BY name`
      );
    } else {
      [rows] = await pool.query(
        `SELECT d.id, d.name, d.uniqueid
         FROM ${tbl("devices")} d
         JOIN ${tbl("user_device")} ud ON ud.deviceid = d.id
         WHERE d.disabled = 0 AND ud.userid = ?
         ORDER BY d.name`,
        [user.id]
      );
    }
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
    const user = req.user;
    const allowed = await requireDeviceAccess(user, deviceId);
    if (!allowed) return res.status(403).json({ error: "forbidden" });

    const start = dayjs(`${month}-01`).startOf("month");
    const end = start.add(1, "month");

    const [rows] = await pool.query(
      `SELECT fixtime, speed
       FROM ${tbl("positions")}
       WHERE deviceid = ? AND fixtime >= ? AND fixtime < ?
       ORDER BY fixtime ASC`,
      [deviceId, start.toDate(), end.toDate()]
    );

    const dashboardCfg = {
      ...cfg,
      stopToleranceSec: cfg.dashboardStopToleranceSec,
      minMovingSeconds: cfg.dashboardMinMovingSeconds,
      minStopSeconds: cfg.dashboardMinStopSeconds
    };
    const { secondsByDay, segmentsByDay } = computeDailyActivity(rows, dashboardCfg);

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
    const user = req.user;
    const allowed = await requireDeviceAccess(user, deviceId);
    if (!allowed) return res.status(403).json({ error: "forbidden" });

    const start = dayjs(`${month}-01`).startOf("month");
    const end = start.add(1, "month");

    const [rows] = await pool.query(
      `SELECT fixtime, attributes, latitude, longitude
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
    const refuels = detectFuelRefuels(series, {
      refuelLiters: cfg.refuelLiters,
      refuelPercent: cfg.refuelPercent
    });

    // Distanzberechnung (nur plausible Sprünge)
    let distanceKmTotal = 0;
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1];
      const cur = rows[i];
      const deltaKm = distanceKm(prev, cur);
      const deltaSec = Math.max(0, dayjs(cur.fixtime).diff(dayjs(prev.fixtime), "second"));
      if (!deltaSec) continue;
      const speedKmh = (deltaKm / deltaSec) * 3600;
      if (speedKmh > cfg.distanceMaxSpeedKmh) continue;
      distanceKmTotal += deltaKm;
    }

    // Verbrauchs-/Korrelation-Stats (io48 = Prozent)
    let consumedPct = 0;
    let refuelPct = 0;
    if (series.length > 1) {
      for (let i = 1; i < series.length; i++) {
        const delta = series[i].fuel - series[i - 1].fuel;
        if (delta > 0) refuelPct += delta;
        if (delta < 0) consumedPct += -delta;
      }
    }
    const netChangePct = series.length ? series[series.length - 1].fuel - series[0].fuel : 0;
    const consumedLiters = (consumedPct / 100) * cfg.tankCapacityLiters;
    const refuelLiters = (refuelPct / 100) * cfg.tankCapacityLiters;
    const netChangeLiters = (netChangePct / 100) * cfg.tankCapacityLiters;
    const expectedLiters = (distanceKmTotal * cfg.avgConsumptionLPer100Km) / 100;
    const refuelSurplusLiters = Math.max(
      0,
      refuelLiters - expectedLiters - Math.max(netChangeLiters, 0)
    );

    res.json({
      deviceId,
      month,
      latest,
      series,
      alerts: [...alerts, ...refuels].sort((a, b) => a.time.localeCompare(b.time)),
      stats: {
        distanceKm: Number(distanceKmTotal.toFixed(1)),
        expectedLiters: Number(expectedLiters.toFixed(1)),
        consumedLiters: Number(consumedLiters.toFixed(1)),
        refuelLiters: Number(refuelLiters.toFixed(1)),
        netChangeLiters: Number(netChangeLiters.toFixed(1)),
        refuelSurplusLiters: Number(refuelSurplusLiters.toFixed(1)),
        avgConsumptionLPer100Km: cfg.avgConsumptionLPer100Km,
        tankCapacityLiters: cfg.tankCapacityLiters
      }
    });
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
    const user = req.user;
    const start = dayjs(`${month}-01`).startOf("month");
    const end = start.add(1, "month");

    let rows;
    if (user?.administrator) {
      [rows] = await pool.query(
        `SELECT d.id AS deviceId, d.name, p.fixtime, p.speed
         FROM ${tbl("devices")} d
         LEFT JOIN ${tbl("positions")} p
           ON p.deviceid = d.id AND p.fixtime >= ? AND p.fixtime < ?
         WHERE d.disabled = 0
         ORDER BY d.id, p.fixtime`,
        [start.toDate(), end.toDate()]
      );
    } else {
      [rows] = await pool.query(
        `SELECT d.id AS deviceId, d.name, p.fixtime, p.speed
         FROM ${tbl("devices")} d
         JOIN ${tbl("user_device")} ud ON ud.deviceid = d.id AND ud.userid = ?
         LEFT JOIN ${tbl("positions")} p
           ON p.deviceid = d.id AND p.fixtime >= ? AND p.fixtime < ?
         WHERE d.disabled = 0
         ORDER BY d.id, p.fixtime`,
        [user.id, start.toDate(), end.toDate()]
      );
    }

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
   Fleet – Monatsalarme (nur negative Drops)
   ======================= */
app.get("/api/fleet/alerts", async (req, res) => {
  const month = String(req.query.month || dayjs().format("YYYY-MM"));
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: "month required (YYYY-MM)" });
  }

  try {
    const user = req.user;
    const start = dayjs(`${month}-01`).startOf("month");
    const end = start.add(1, "month");

    let devices;
    if (user?.administrator) {
      [devices] = await pool.query(
        `SELECT id FROM ${tbl("devices")} WHERE disabled = 0`
      );
    } else {
      [devices] = await pool.query(
        `SELECT d.id
         FROM ${tbl("devices")} d
         JOIN ${tbl("user_device")} ud ON ud.deviceid = d.id AND ud.userid = ?
         WHERE d.disabled = 0`,
        [user.id]
      );
    }

    let totalDrops = 0;

    for (const d of devices) {
      const [rows] = await pool.query(
        `SELECT fixtime, attributes
         FROM ${tbl("positions")}
         WHERE deviceid = ? AND fixtime >= ? AND fixtime < ?
         ORDER BY fixtime ASC`,
        [d.id, start.toDate(), end.toDate()]
      );

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

      const drops = detectFuelDrops(series, {
        dropLiters: cfg.fuelDropLiters,
        dropPercent: cfg.fuelDropPercent,
        windowMinutes: cfg.fuelWindowMinutes
      });

      totalDrops += drops.length;
    }

    res.json({ month, totalDrops });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "fleet_alerts_failed" });
  }
});

/* =======================
   Fleet – Aktueller Status (Dispatcher)
   ======================= */
app.get("/api/fleet/status", async (_req, res) => {
  try {
    const user = _req.user;
    let rows;
    if (user?.administrator) {
      [rows] = await pool.query(
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
    } else {
      [rows] = await pool.query(
        `SELECT d.id AS deviceId, d.name, p.fixtime, p.latitude, p.longitude, p.speed, p.attributes, p.address
         FROM ${tbl("devices")} d
         JOIN ${tbl("user_device")} ud ON ud.deviceid = d.id AND ud.userid = ?
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
         ORDER BY d.name`,
        [user.id]
      );
    }

    const devices = [];

    for (const r of rows) {
      let attrsObj = null;
      try {
        const raw = Buffer.isBuffer(r.attributes) ? r.attributes.toString("utf8") : r.attributes;
        attrsObj = typeof raw === "string" ? JSON.parse(raw) : raw;
      } catch {
        attrsObj = null;
      }

      let fuel = null;
      try {
        fuel = extractFuelValue(attrsObj ?? r.attributes, cfg.fuelKeys);
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
        const refuels = detectFuelRefuels(series, {
          refuelLiters: cfg.refuelLiters,
          refuelPercent: cfg.refuelPercent
        });
        const combinedAlerts = [...alerts, ...refuels].sort((a, b) => a.time.localeCompare(b.time));
        if (combinedAlerts.length) fuelAlert = combinedAlerts[combinedAlerts.length - 1];
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
let geocodeActive = 0;
const geocodeQueue = [];

async function withGeocodeLimit(fn) {
  if (!Number.isFinite(cfg.geocodeConcurrency) || cfg.geocodeConcurrency <= 0) {
    return fn();
  }
  if (geocodeActive >= cfg.geocodeConcurrency) {
    await new Promise((resolve) => geocodeQueue.push(resolve));
  }
  geocodeActive += 1;
  try {
    return await fn();
  } finally {
    geocodeActive -= 1;
    const next = geocodeQueue.shift();
    if (next) next();
  }
}

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
    return await withGeocodeLimit(async () => {
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
      return null;
    });
  } catch (err) {
    console.error("reverse_geocode_failed", err);
  }
  return null;
}

async function resolveAddress(addr, lat, lon, opts = {}) {
  const allowGeocode = opts.allowGeocode !== false;
  const normalized = normalizeAddress(addr);
  if (normalized) return normalized;
  if (allowGeocode) {
    const geo = await reverseGeocode(lat, lon);
    if (geo) return geo;
  }
  if (Number.isFinite(lat) && Number.isFinite(lon)) return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  return "Adresse fehlt";
}

async function buildActivityReport(deviceId, month, opts = {}) {
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

  const dayRowsMap = new Map();
  for (const r of rows) {
    const dayKey = dayjs(r.fixtime).format("YYYY-MM-DD");
    const entry = { ...r, _day: dayKey, _ts: dayjs(r.fixtime).valueOf() };
    if (!dayRowsMap.has(dayKey)) dayRowsMap.set(dayKey, []);
    dayRowsMap.get(dayKey).push(entry);
  }

  const activityCfg = opts.detail
    ? { ...cfg, minStopSeconds: cfg.detailStopSeconds }
    : cfg;
  const { secondsByDay, segmentsByDay } = computeDailyActivity(rows, activityCfg);

  const daysInMonth = end.subtract(1, "day").date();
  let totalSeconds = 0;
  let totalDistanceKm = 0;
  let barRowsHtml = "";
  let dayListRowsHtml = "";

  const findNearestPosition = (dayRows, targetMs) => {
    if (!dayRows.length) return null;
    let lo = 0;
    let hi = dayRows.length - 1;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const v = dayRows[mid]._ts;
      if (v === targetMs) return dayRows[mid];
      if (v < targetMs) lo = mid + 1;
      else hi = mid - 1;
    }
    const idx = Math.min(Math.max(lo, 0), dayRows.length - 1);
    const a = dayRows[idx];
    const b = idx > 0 ? dayRows[idx - 1] : null;
    if (!b) return a;
    return Math.abs(a._ts - targetMs) < Math.abs(b._ts - targetMs) ? a : b;
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

  const lowerBoundTs = (arr, targetMs) => {
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (arr[mid]._ts < targetMs) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  const upperBoundTs = (arr, targetMs) => {
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (arr[mid]._ts <= targetMs) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  const rowsInRange = (arr, startMs, endMs) => {
    if (!arr.length) return [];
    const startIdx = lowerBoundTs(arr, startMs);
    const endIdx = upperBoundTs(arr, endMs);
    if (startIdx >= endIdx) return [];
    return arr.slice(startIdx, endIdx);
  };

  const segmentRows = [];
  const dayEntries = [];
  const detailEntries = [];
  const addressPromises = [];

  const mergeSegments = (segments, gapSec) => {
    if (!segments.length) return [];
    const out = [];
    let cur = { ...segments[0] };
    for (let i = 1; i < segments.length; i++) {
      const s = segments[i];
      if (s.start - cur.end <= gapSec) {
        cur.end = s.end;
      } else {
        out.push(cur);
        cur = { ...s };
      }
    }
    out.push(cur);
    return out;
  };

  const addressCache = new Map();
  const resolveAddressCached = (addr, lat, lon, allowGeocode) => {
    const key = `${addr || ""}|${Number.isFinite(lat) ? lat.toFixed(5) : ""}|${
      Number.isFinite(lon) ? lon.toFixed(5) : ""
    }|${allowGeocode ? "geo" : "nogeo"}`;
    if (addressCache.has(key)) return addressCache.get(key);
    const promise = resolveAddress(addr, lat, lon, { allowGeocode }).catch(() => "Adresse fehlt");
    addressCache.set(key, promise);
    return promise;
  };

  const formatAddressForReport = (addr) => {
    if (!addr) return "-";
    const raw = String(addr);
    const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
    const drop = new Set(["AT", "Austria", "Upper Austria", "Oberösterreich", "Upper Austria"]);
    const cleaned = parts.filter((p) => !drop.has(p));
    if (cleaned.length >= 3 && /^\d{4,5}$/.test(cleaned[1])) {
      const combined = `${cleaned[1]} ${cleaned[2]}`.trim();
      cleaned.splice(1, 2, combined);
    }
    const short = cleaned.slice(0, 3).join(", ");
    return short.replace(/, /g, ", <wbr>");
  };

  for (let d = 1; d <= daysInMonth; d++) {
    const day = start.date(d).format("YYYY-MM-DD");
    const sec = secondsByDay.get(day) || 0;
    totalSeconds += sec;
    const hours = (sec / 3600).toFixed(2);
    const width = Math.min(100, (sec / 86400) * 100);

    const dayRows = dayRowsMap.get(day) || [];
    const segmentsRaw = segmentsByDay.get(day) || [];
    const segments = opts.detail && cfg.detailGapSeconds > 0
      ? mergeSegments(segmentsRaw, cfg.detailGapSeconds)
      : segmentsRaw;

    // Start/End nach echter Fahrt (erstes/letztes Sample über Threshold)
    let firstMoving = null;
    let lastMoving = null;
    for (const r of dayRows) {
      if (Number(r.speed) >= cfg.minSpeedKmh) {
        if (!firstMoving) firstMoving = r;
        lastMoving = r;
      }
    }
    const startTimeIso = firstMoving ? dayjs(firstMoving.fixtime).toISOString() : null;
    const endTimeIso = lastMoving ? dayjs(lastMoving.fixtime).toISOString() : null;

    const startPos = startTimeIso
      ? findNearestPosition(dayRows, dayjs(startTimeIso).valueOf())
      : null;
    const endPos = endTimeIso
      ? findNearestPosition(dayRows, dayjs(endTimeIso).valueOf())
      : null;

    const startAddrP = startPos
      ? resolveAddressCached(
          startPos.address,
          startPos.latitude,
          startPos.longitude,
          cfg.pdfGeocode
        )
      : Promise.resolve("-");
    const endAddrP = endPos
      ? resolveAddressCached(
          endPos.address,
          endPos.latitude,
          endPos.longitude,
          cfg.pdfGeocode
        )
      : Promise.resolve("-");
    addressPromises.push(startAddrP, endAddrP);

    // Distanz pro Tag (ungefähr, Haversine zwischen Positionspunkten)
    // Filtert unrealistische GPS-Sprünge per Max-Geschwindigkeit.
    let dayDistance = 0;
    for (let i = 1; i < dayRows.length; i++) {
      const prev = dayRows[i - 1];
      const cur = dayRows[i];
      const deltaKm = distanceKm(prev, cur);
      const deltaSec = Math.max(0, dayjs(cur.fixtime).diff(dayjs(prev.fixtime), "second"));
      if (!deltaSec) continue;
      const speedKmh = (deltaKm / deltaSec) * 3600;
      if (speedKmh > cfg.distanceMaxSpeedKmh) continue;
      dayDistance += deltaKm;
    }
    totalDistanceKm += dayDistance;

    const timeline = segments
      .map((s) => {
        const left = (s.start / SECONDS_DAY) * 100;
        const width = ((s.end - s.start) / SECONDS_DAY) * 100;
        return `<span class="bar-seg" style="left:${left}%; width:${width}%;"></span>`;
      })
      .join("");

    if (opts.detail) {
      const dayStart = dayjs(day).startOf("day");
      const mergedSegments = [];
      for (const seg of segments) {
        if (!mergedSegments.length) {
          mergedSegments.push({ ...seg });
          continue;
        }
        const prev = mergedSegments[mergedSegments.length - 1];
        const gapSec = Math.max(0, seg.start - prev.end);
        if (gapSec <= cfg.detailMergeStopSeconds) {
          const prevEnd = findNearestPosition(
            dayRows,
            dayStart.add(prev.end, "second").valueOf()
          );
          const curStart = findNearestPosition(
            dayRows,
            dayStart.add(seg.start, "second").valueOf()
          );
          const distM = distanceKm(prevEnd, curStart) * 1000;
          if (distM < cfg.detailMinStartEndDistanceM) {
            prev.end = seg.end;
            continue;
          }
        }
        mergedSegments.push({ ...seg });
      }

      for (const seg of mergedSegments) {
        const segStart = dayStart.add(seg.start, "second");
        const segEnd = dayStart.add(seg.end, "second");
        const segRows = rowsInRange(dayRows, segStart.valueOf(), segEnd.valueOf());
        if (segRows.length < 2) continue;

        const segDurationSec = seg.end - seg.start;
        if (segDurationSec < cfg.detailMinSegmentSeconds) continue;

        let segDistanceKm = 0;
        for (let i = 1; i < segRows.length; i++) {
          const deltaKm = distanceKm(segRows[i - 1], segRows[i]);
          const deltaSec = Math.max(0, (segRows[i]._ts - segRows[i - 1]._ts) / 1000);
          if (!deltaSec) continue;
          const speedKmh = (deltaKm / deltaSec) * 3600;
          if (speedKmh > cfg.distanceMaxSpeedKmh) continue;
          segDistanceKm += deltaKm;
        }
        if (segDistanceKm * 1000 < cfg.detailMinSegmentDistanceM) continue;

        const segStartPos = segRows[0];
        const segEndPos = segRows[segRows.length - 1];
        if (distanceKm(segStartPos, segEndPos) * 1000 < cfg.detailMinStartEndDistanceM) {
          continue;
        }

        const segStartAddrP = segStartPos
          ? resolveAddressCached(
              segStartPos.address,
              segStartPos.latitude,
              segStartPos.longitude,
              cfg.pdfGeocode
            )
          : Promise.resolve("-");
        const segEndAddrP = segEndPos
          ? resolveAddressCached(
              segEndPos.address,
              segEndPos.latitude,
              segEndPos.longitude,
              cfg.pdfGeocode
            )
          : Promise.resolve("-");
        addressPromises.push(segStartAddrP, segEndAddrP);

        detailEntries.push({
          day,
          start: segStart.format("HH:mm"),
          end: segEnd.format("HH:mm"),
          startAddrP: segStartAddrP,
          endAddrP: segEndAddrP,
          startTs: segStart.valueOf(),
          endTs: segEnd.valueOf(),
          startLat: segStartPos?.latitude,
          startLon: segStartPos?.longitude,
          endLat: segEndPos?.latitude,
          endLon: segEndPos?.longitude,
          duration: ((seg.end - seg.start) / 3600).toFixed(2),
        });
      }
    }

    barRowsHtml += `<tr class="bar-row">
      <td>${day}</td>
      <td>
        <div class="bar">
          ${timeline || ""}
        </div>
      </td>
      <td style="text-align:right; font-variant-numeric: tabular-nums;">${hours}</td>
      <td style="text-align:right; font-variant-numeric: tabular-nums;">${dayDistance.toFixed(1)} km</td>
    </tr>`;

    dayEntries.push({
      day,
      startTime: startTimeIso ? dayjs(startTimeIso).format("HH:mm") : "-",
      endTime: endTimeIso ? dayjs(endTimeIso).format("HH:mm") : "-",
      startAddrP,
      endAddrP,
      dayDistance,
      hours
    });
  }

  if (addressPromises.length) {
    await Promise.all(addressPromises);
  }

  for (const e of dayEntries) {
    const startAddr = formatAddressForReport(await e.startAddrP);
    const endAddr = formatAddressForReport(await e.endAddrP);
    dayListRowsHtml += `<tr>
      <td>${e.day}</td>
      <td>${e.startTime}</td>
      <td>${startAddr}</td>
      <td>${e.endTime}</td>
      <td>${endAddr}</td>
      <td style="text-align:right; font-variant-numeric: tabular-nums;">${e.dayDistance.toFixed(1)} km</td>
      <td style="text-align:right; font-variant-numeric: tabular-nums;">${e.hours}</td>
    </tr>`;
  }

  for (const e of detailEntries) {
    const startAddr = formatAddressForReport(await e.startAddrP);
    const endAddr = formatAddressForReport(await e.endAddrP);
    segmentRows.push({
      day: e.day,
      start: e.start,
      end: e.end,
      startAddr,
      endAddr,
      duration: e.duration,
      startTs: e.startTs,
      endTs: e.endTs,
      startLat: e.startLat,
      startLon: e.startLon,
      endLat: e.endLat,
      endLon: e.endLon
    });
  }

  const mergedSegmentRows = [];
  for (const row of segmentRows) {
    if (!mergedSegmentRows.length) {
      mergedSegmentRows.push({ ...row });
      continue;
    }
    const prev = mergedSegmentRows[mergedSegmentRows.length - 1];
    const sameDay = prev.day === row.day;
    const gapSec = Math.max(0, (row.startTs - prev.endTs) / 1000);
    const sameAddresses = prev.startAddr === row.startAddr && prev.endAddr === row.endAddr;
    const distM = distanceKm(
      { latitude: prev.endLat, longitude: prev.endLon },
      { latitude: row.startLat, longitude: row.startLon }
    ) * 1000;

    if (sameDay && gapSec <= cfg.detailMergeStopSeconds && (sameAddresses || distM < cfg.detailMinStartEndDistanceM)) {
      prev.end = row.end;
      prev.endAddr = row.endAddr;
      prev.endTs = row.endTs;
      prev.endLat = row.endLat;
      prev.endLon = row.endLon;
      const durationHours = (prev.endTs - prev.startTs) / 3600000;
      prev.duration = durationHours.toFixed(2);
      continue;
    }
    mergedSegmentRows.push({ ...row });
  }

  const totalHours = (totalSeconds / 3600).toFixed(2);
  const totalDistanceStr = totalDistanceKm.toFixed(1);

  const dayListTable = `
  <div class="page-break"></div>
  <h2>Monatsübersicht – Tagesliste</h2>
  <div class="subtle">Start/Ende pro Tag</div>
  <table class="bar-table">
    <thead>
      <tr>
        <th>Tag</th>
        <th>Start (Zeit)</th>
        <th>Start (Ort)</th>
        <th>Ende (Zeit)</th>
        <th>Ende (Ort)</th>
        <th class="right">Distanz (km)</th>
        <th class="right">Aktive Zeit (h)</th>
      </tr>
    </thead>
    <tbody>
      ${dayListRowsHtml}
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
      </tr>
    </tfoot>
  </table>
  `;

  const detailTable = !opts.detail || !mergedSegmentRows.length ? "" : `
  <div class="page-break"></div>
  <h2>Detail – Fahrtenliste</h2>
  <div class="subtle">Einzelfahrten gemäß Fahrzeitblöcken</div>
  <table class="detail-table">
    <thead>
      <tr>
        <th>Tag</th>
        <th>Start</th>
        <th>Start-Ort</th>
        <th>Ende</th>
        <th>Ende-Ort</th>
        <th class="right">Dauer (h)</th>
      </tr>
    </thead>
    <tbody>
      ${(() => {
        let lastDay = null;
        let i = 0;
        return mergedSegmentRows.map((r) => {
          const dayLine = r.day !== lastDay
            ? `<tr class="day-row"><td colspan="6">${r.day}</td></tr>`
            : "";
          lastDay = r.day;
          const row = `<tr class="${i % 2 ? "row-alt" : ""}">
            <td>${r.day}</td>
            <td>${r.start}</td>
            <td>${r.startAddr}</td>
            <td>${r.end}</td>
            <td>${r.endAddr}</td>
            <td class="right" style="font-variant-numeric: tabular-nums;">${r.duration}</td>
          </tr>`;
          i += 1;
          return dayLine + row;
        }).join("");
      })()}
    </tbody>
  </table>
  `;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <style>
    body { font-family: "Helvetica Neue", Arial, sans-serif; font-size: 12px; color:#0f172a; }
    h1 { font-size: 20px; margin: 0 0 6px; }
    h2 { font-size: 16px; margin: 0 0 6px; }
    .meta { margin-bottom: 10px; }
    .badge { display:inline-block; padding:4px 10px; border:1px solid #e2e8f0; border-radius:999px; margin-right:6px; background:#f8fafc; }
    .summary { display:flex; gap:10px; margin:10px 0 12px; }
    .card { border:1px solid #e2e8f0; border-radius:10px; padding:8px 10px; background:#fff; min-width:140px; }
    .card .label { color:#64748b; font-size:11px; }
    .card .value { font-size:16px; font-weight:700; margin-top:2px; }
    table { width:100%; border-collapse: collapse; }
    th, td { border-bottom:1px solid #e5e7eb; padding:6px 6px; vertical-align:middle; }
    th { background:#f8fafc; text-align:left; }
    .right { text-align:right; }
    .subtle { color:#64748b; margin-bottom:6px; font-size:11px; }
    .bar { position:relative; height:18px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; overflow:hidden;
           background-image: repeating-linear-gradient(to right, #e2e8f0 0, #e2e8f0 1px, transparent 1px, transparent 4.1667%); }
    .bar-scale { display:flex; justify-content:space-between; font-size:10px; color:#94a3b8; margin-top:4px; }
    .bar-col { width:100%; }
    .bar-table { table-layout: fixed; }
    .bar-table th:nth-child(1) { width:120px; }
    .bar-table th:nth-child(3) { width:90px; }
    .bar-table th:nth-child(4) { width:90px; }
    .bar-row td { vertical-align: middle; }
    .bar-seg { position:absolute; top:0; bottom:0; background:#2563eb; }
    .page-break { page-break-before: always; }
    .detail-table { table-layout: fixed; }
    .detail-table th, .detail-table td { padding:5px 6px; }
    .detail-table th:nth-child(1) { width:90px; }
    .detail-table th:nth-child(2),
    .detail-table th:nth-child(4) { width:50px; }
    .detail-table th:nth-child(6) { width:70px; }
    .detail-table td:nth-child(3),
    .detail-table td:nth-child(5) {
      word-break: keep-all;
      overflow-wrap: normal;
      hyphens: auto;
    }
    .detail-table .day-row td {
      background:#eef2ff;
      font-weight:700;
      border-top:1px solid #c7d2fe;
    }
    .row-alt { background:#f8fafc; }
    .footer { margin-top:12px; color:#64748b; font-size:10px; }
  </style>
</head>
<body>
  <h1>QT FleetControl – Fahrtenbuch Monatsreport</h1>
  <div class="meta">
    <span class="badge">Fahrzeug: ${device?.name || deviceId}</span>
    <span class="badge">Monat: ${month}</span>
    <span class="badge">Gültig: Fahrtenbuch AT</span>
  </div>
  <div class="summary">
    <div class="card">
      <div class="label">Gesamtstunden</div>
      <div class="value">${totalHours} h</div>
    </div>
    <div class="card">
      <div class="label">Gesamtdistanz</div>
      <div class="value">${totalDistanceStr} km</div>
    </div>
  </div>

  <h2>Monatsübersicht – Balken</h2>
  <div class="subtle">Aktive Zeit pro Tag (Zeitskala 0–24h)</div>
  <table>
    <thead>
      <tr>
        <th>Tag</th>
        <th class="bar-col">Balken</th>
        <th class="right">Zeit (h)</th>
        <th class="right">Km</th>
      </tr>
      <tr>
        <th></th>
        <th>
          <div class="bar-scale">
            <span>0</span>
            <span>6</span>
            <span>12</span>
            <span>18</span>
            <span>24</span>
          </div>
        </th>
        <th></th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      ${barRowsHtml}
    </tbody>
    <tfoot>
      <tr>
        <th>Summe</th>
        <th></th>
        <th class="right">${totalHours}</th>
        <th class="right">${totalDistanceStr}</th>
        <th></th>
      </tr>
    </tfoot>
  </table>

  <div class="footer">
    Messbasis: Traccar Telemetrie (OBD). Österreich-konformes Fahrtenbuch (Monatsansicht) – Start/Ende je Tag, aktive Zeit.<br/>
    Parameter: minSpeed=${cfg.minSpeedKmh} km/h,
    stopTolerance=${cfg.stopToleranceSec}s,
    minBlock=${cfg.minMovingSeconds}s,
    minStop=${cfg.minStopSeconds}s
  </div>

  ${dayListTable}

  ${detailTable}
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
  const detail = req.query.detail === "1" || req.query.detail === "true";

  if (!deviceId || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: "deviceId & month required (YYYY-MM)" });
  }

  try {
    const user = req.user;
    const allowed = await requireDeviceAccess(user, deviceId);
    if (!allowed) return res.status(403).json({ error: "forbidden" });

    const { pdf, filename } = await buildActivityReport(deviceId, month, { detail });
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
  const detail = req.query.detail === "1" || req.query.detail === "true";
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: "month required (YYYY-MM)" });
  }

  let deviceIds = String(req.query.deviceIds || "")
    .split(",")
    .map((id) => Number(id))
    .filter((n) => Number.isFinite(n));

  try {
    const user = req.user;
    if (!deviceIds.length) {
      if (user?.administrator) {
        const [rows] = await pool.query(
          `SELECT id FROM ${tbl("devices")} WHERE disabled = 0 ORDER BY name`
        );
        deviceIds = rows.map((r) => r.id);
      } else {
        const [rows] = await pool.query(
          `SELECT d.id
           FROM ${tbl("devices")} d
           JOIN ${tbl("user_device")} ud ON ud.deviceid = d.id AND ud.userid = ?
           WHERE d.disabled = 0
           ORDER BY d.name`,
          [user.id]
        );
        deviceIds = rows.map((r) => r.id);
      }
    }

    if (!deviceIds.length) {
      return res.status(400).json({ error: "no_devices" });
    }

    if (!user?.administrator) {
      const [rows] = await pool.query(
        `SELECT deviceid FROM ${tbl("user_device")} WHERE userid = ?`,
        [user.id]
      );
      const allowedIds = new Set(rows.map((r) => Number(r.deviceid)));
      deviceIds = deviceIds.filter((id) => allowedIds.has(id));
      if (!deviceIds.length) return res.status(403).json({ error: "forbidden" });
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
        const { pdf, filename } = await buildActivityReport(id, month, { detail });
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
