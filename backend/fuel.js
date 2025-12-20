import dayjs from "dayjs";

export function extractFuelValue(attributes, key) {
  if (!attributes) return null;
  const obj = typeof attributes === "string" ? JSON.parse(attributes) : attributes;
  const v = obj?.[key];
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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