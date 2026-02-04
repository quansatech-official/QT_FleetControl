import React, { useEffect, useState } from "react";
import Dashboard from "./pages/Dashboard.jsx";
import Login from "./components/Login.jsx";
import { apiGet, apiPost, clearToken, getToken, setToken } from "./api.js";
import logo from "../QTIT.png";

export default function App() {
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [loginError, setLoginError] = useState("");

  useEffect(() => {
    const authDisabled = String(import.meta.env.VITE_AUTH_DISABLED || "").toLowerCase() === "true";
    if (authDisabled) {
      setUser({ id: 0, name: "debug", administrator: true });
      setAuthChecked(true);
      return;
    }
    const token = getToken();
    if (!token) {
      setAuthChecked(true);
      return;
    }
    apiGet("/me")
      .then((res) => {
        setUser(res?.user || null);
      })
      .catch(() => {
        clearToken();
        setUser(null);
      })
      .finally(() => setAuthChecked(true));
  }, []);

  const handleLogin = async ({ identifier, password }) => {
    const authDisabled = String(import.meta.env.VITE_AUTH_DISABLED || "").toLowerCase() === "true";
    if (authDisabled) return;
    setLoginError("");
    try {
      const res = await apiPost("/login", { identifier, password });
      if (!res?.token) {
        setLoginError("Login fehlgeschlagen");
        return;
      }
      setToken(res.token);
      setUser(res.user || null);
    } catch (err) {
      console.error(err);
      setLoginError("Login fehlgeschlagen");
    }
  };

  const handleLogout = () => {
    clearToken();
    setUser(null);
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #0f172a, #111827 35%, #0b1225)",
        color: "#0f172a",
        padding: "24px 16px",
        boxSizing: "border-box"
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          background: "#fff",
          borderRadius: 16,
          boxShadow: "0 24px 60px rgba(0,0,0,0.18)",
          overflow: "hidden",
          border: "1px solid #e5e7eb"
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "14px 18px",
            background: "linear-gradient(90deg, #0ea5e9, #2563eb)",
          color: "#fff"
        }}
      >
        <img
          src={logo}
          alt="Quansatech GmbH"
          style={{
            width: 44,
            height: 44,
            objectFit: "contain",
            borderRadius: 12,
            background: "rgba(255,255,255,0.14)",
            border: "1px solid rgba(255,255,255,0.25)",
            padding: 4
          }}
        />
          <div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>Quansatech GmbH · FleetControl</div>
            <div style={{ fontSize: 12, opacity: 0.9 }}>
              Fleet Analytics Dashboard – Live, Controlling & Werkstatt
            </div>
          </div>
          {user ? (
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ fontSize: 12, opacity: 0.9 }}>
                {user.name || user.email || "User"}
              </div>
              <button
                onClick={handleLogout}
                style={{
                  padding: "6px 10px",
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.6)",
                  background: "rgba(255,255,255,0.15)",
                  color: "#fff",
                  fontWeight: 600
                }}
              >
                Logout
              </button>
            </div>
          ) : null}
        </header>

        <main style={{ padding: 16 }}>
          {!authChecked ? (
            <div style={{ padding: 24, color: "#475569" }}>Authentifizierung…</div>
          ) : user ? (
            <Dashboard />
          ) : (
            <Login onSubmit={handleLogin} error={loginError} />
          )}
        </main>
      </div>
    </div>
  );
}
