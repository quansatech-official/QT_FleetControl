import dayjs from "dayjs";

function splitBlockByDay(start, end) {
  const out = [];
  let cur = start;

  while (cur.isBefore(end)) {
    const next = cur.endOf("day").add(1, "ms");
    const stop = next.isBefore(end) ? next : end;
    out.push({ day: cur.format("YYYY-MM-DD"), seconds: stop.diff(cur, "second") });
    cur = stop;
  }
  return out;
}

export function computeDailyActiveSeconds(rows, cfg) {
  let blockStart = null;
  let lastMove = null;
  const daily = new Map();

  const flush = () => {
    if (!blockStart || !lastMove) return;
    const dur = dayjs(lastMove).diff(dayjs(blockStart), "second");
    if (dur >= cfg.minMovingSeconds) {
      for (const p of splitBlockByDay(dayjs(blockStart), dayjs(lastMove))) {
        daily.set(p.day, (daily.get(p.day) || 0) + p.seconds);
      }
    }
    blockStart = null;
    lastMove = null;
  };

  for (const r of rows) {
    const t = dayjs(r.fixtime);
    if (Number(r.speed) >= cfg.minSpeedKmh) {
      if (!blockStart) blockStart = t.toISOString();
      lastMove = t.toISOString();
    } else if (blockStart) {
      if (t.diff(dayjs(lastMove), "second") > cfg.stopToleranceSec) flush();
    }
  }
  flush();
  return daily;
}