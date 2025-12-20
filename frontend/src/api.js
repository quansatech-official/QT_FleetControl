export const API_BASE = import.meta.env.VITE_API_BASE;

export async function apiGet(path) {
  const r = await fetch(`${API_BASE}${path}`);
  if (!r.ok) throw new Error("API error");
  return r.json();
}