const envBase = import.meta.env.VITE_API_BASE;
const envIsLocalhost = !!envBase && /(localhost|127\\.0\\.0\\.1)/.test(envBase);

// Resolve API base URL at runtime. Fall back to server host:3000 when no env
// is provided or when a localhost base was baked into the bundle but the app
// is opened from a remote host (common with docker-compose + nginx).
const fallbackBase = `${window.location.protocol}//${window.location.hostname}:3000/api`;
export const API_BASE =
  (!envBase ||
    (envIsLocalhost &&
      window.location.hostname !== "localhost" &&
      window.location.hostname !== "127.0.0.1")) ?
      fallbackBase :
      envBase;

export async function apiGet(path) {
  const r = await fetch(`${API_BASE}${path}`);
  if (!r.ok) throw new Error("API error");
  return r.json();
}
