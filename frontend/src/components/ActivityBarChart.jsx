import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

export default function ActivityBarChart({ data }) {
  const chartData = (data || []).map(d => ({
    day: d.day.slice(-2), // 01..31
    hours: Math.round((d.activeSeconds / 3600) * 100) / 100
  }));

  return (
    <div style={{ width: "100%", height: 320 }}>
      <ResponsiveContainer>
        <BarChart data={chartData}>
          <XAxis dataKey="day" />
          <YAxis />
          <Tooltip formatter={(v) => [`${v} h`, "Aktiv"]} />
          <Bar dataKey="hours" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}