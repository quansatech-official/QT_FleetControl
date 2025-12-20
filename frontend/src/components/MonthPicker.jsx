import dayjs from "dayjs";

export default function MonthPicker({ month, setMonth }) {
  const prev = () =>
    setMonth(dayjs(`${month}-01`).subtract(1, "month").format("YYYY-MM"));

  const next = () =>
    setMonth(dayjs(`${month}-01`).add(1, "month").format("YYYY-MM"));

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <button onClick={prev}>◀</button>
      <strong>{month}</strong>
      <button onClick={next}>▶</button>
    </div>
  );
}