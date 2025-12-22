const envBase = import.meta.env.VITE_API_BASE;

function hostFromUrl(url) {
  if (!url) return "";
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function isPrivateHost(host) {
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    /^172\\.(1[6-9]|2\\d|3[0-1])\\./.test(host)
  );
}

const envHost = hostFromUrl(envBase);
const envIsLocalhost = !!envHost && isPrivateHost(envHost);

// Resolve API base URL at runtime. Fall back to same-origin /api so a reverse
// proxy can front the internal backend.
const fallbackBase = `${window.location.origin}/api`;
const windowHost = window.location.hostname;
const useFallback =
  !envBase || (envIsLocalhost && !isPrivateHost(windowHost));
export const API_BASE = useFallback ? fallbackBase : envBase;

export async function apiGet(path) {
  const r = await fetch(`${API_BASE}${path}`);
  if (!r.ok) throw new Error("API error");
  return r.json();
}
