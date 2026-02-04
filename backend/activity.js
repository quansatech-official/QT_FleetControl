import dayjs from "dayjs";

function splitBlockByDay(start, end) {
  const out = [];
  let cur = start;

  while (cur.isBefore(end)) {
    const dayStart = cur.startOf("day");
    const next = cur.endOf("day").add(1, "ms");
    const stop = next.isBefore(end) ? next : end;
    out.push({
      day: cur.format("YYYY-MM-DD"),
      seconds: stop.diff(cur, "second"),
      startSec: cur.diff(dayStart, "second"),
      endSec: stop.diff(dayStart, "second"),
    });
    cur = stop;
  }
  return out;
}

export function computeDailyActivity(rows, cfg) {
  let blockStart = null;
  let lastMove = null;
  let prevTime = null;
  const secondsByDay = new Map();
  const segmentsByDay = new Map();

  const flush = () => {
    if (!blockStart || !lastMove) return;
    const dur = dayjs(lastMove).diff(dayjs(blockStart), "second");
    if (dur >= cfg.minMovingSeconds) {
      for (const p of splitBlockByDay(dayjs(blockStart), dayjs(lastMove))) {
        secondsByDay.set(p.day, (secondsByDay.get(p.day) || 0) + p.seconds);
        const list = segmentsByDay.get(p.day) || [];
        list.push({ start: p.startSec, end: p.endSec });
        segmentsByDay.set(p.day, list);
      }
    }
    blockStart = null;
    lastMove = null;
  };

  for (const r of rows) {
    const t = dayjs(r.fixtime);
    if (prevTime) {
      const gapSec = t.diff(prevTime, "second");
      if (gapSec >= cfg.minStopSeconds) {
        // Hard split on data gaps to surface stops between samples.
        flush();
      }
    }
    if (Number(r.speed) >= cfg.minSpeedKmh) {
      if (!blockStart) blockStart = t.toISOString();
      lastMove = t.toISOString();
    } else if (blockStart) {
      const idleSec = t.diff(dayjs(lastMove), "second");
      if (idleSec >= cfg.minStopSeconds) {
        flush();
      } else if (idleSec > cfg.stopToleranceSec) {
        // tolerate brief drops below speed threshold
        // without ending the current moving block
      }
    }
    prevTime = t;
  }
  flush();
  return { secondsByDay, segmentsByDay };
}
