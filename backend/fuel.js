import dayjs from "dayjs";

function readPath(obj, path) {
  if (!obj || !path) return null;
  const parts = path
    .replace(/\[(\w+)\]/g, ".$1")
    .split(".");
  let cur = obj;
  for (const p of parts) {
    cur = cur?.[p];
    if (cur === undefined) return null;
  }
  return cur;
}

export function extractFuelValue(attributes, keys) {
  if (attributes === null || attributes === undefined) return null;

  let obj = attributes;
  if (typeof attributes === "string") {
    try {
      obj = JSON.parse(attributes);
    } catch {
      // Traccar kann auch mal "null" oder kaputtes JSON liefern – dann brechen wir hier ab.
      return null;
    }
  }

  const list = Array.isArray(keys) ? keys : [keys];
  for (const k of list) {
    const raw = k.includes(".") ? readPath(obj, k) : obj?.[k];
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function detectFuelDrops(series, cfg) {
  const alerts = [];
  for (let i = 1; i < series.length; i++) {
    const drop = series[i - 1].fuel - series[i].fuel;
    if (
      drop >= cfg.fuelDropLiters ||
      (drop / series[i - 1].fuel) * 100 >= cfg.fuelDropPercent
    ) {
      alerts.push({
        time: series[i].time,
        from: series[i - 1].fuel,
        to: series[i].fuel,
        drop
      });
    }
  }
  return alerts;
}
