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

const TOKEN_KEY = "qt_fc_token";

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore storage errors
  }
}

export function clearToken() {
  setToken("");
}

export function withAuthToken(url) {
  const token = getToken();
  if (!token) return url;
  try {
    const u = new URL(url, window.location.origin);
    u.searchParams.set("token", token);
    return u.toString();
  } catch {
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}token=${encodeURIComponent(token)}`;
  }
}

async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;

  const r = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers
  });

  if (r.status === 401) {
    clearToken();
  }
  if (!r.ok) throw new Error("API error");
  return r;
}

export async function apiGet(path) {
  const r = await apiFetch(path);
  return r.json();
}

export async function apiPost(path, body) {
  const r = await apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  });
  return r.json();
}
