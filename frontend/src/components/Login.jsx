import React, { useState } from "react";

export default function Login({ onSubmit, error }) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!identifier || !password) return;
    setSubmitting(true);
    try {
      await onSubmit({ identifier, password });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "60vh",
        display: "grid",
        placeItems: "center",
        padding: 24
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          width: "100%",
          maxWidth: 420,
          background: "#f8fafc",
          border: "1px solid #e5e7eb",
          borderRadius: 16,
          padding: 24,
          boxShadow: "0 12px 30px rgba(15,23,42,0.12)"
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>
          Traccar Login
        </div>
        <div style={{ fontSize: 13, color: "#475569", marginBottom: 18 }}>
          Mit Traccar Benutzerkonto anmelden
        </div>

        <label style={{ display: "grid", gap: 6, marginBottom: 12 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>
            E-Mail oder Benutzername
          </span>
          <input
            type="text"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder="name@firma.com"
            autoComplete="username"
            required
          />
        </label>

        <label style={{ display: "grid", gap: 6, marginBottom: 16 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>
            Passwort
          </span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        {error ? (
          <div
            style={{
              marginBottom: 12,
              fontSize: 12,
              color: "#b91c1c",
              background: "#fee2e2",
              padding: "8px 10px",
              borderRadius: 8
            }}
          >
            {error}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={submitting}
          style={{
            width: "100%",
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid #1d4ed8",
            background: submitting ? "#93c5fd" : "#2563eb",
            color: "#fff",
            fontWeight: 700
          }}
        >
          {submitting ? "Anmelden..." : "Anmelden"}
        </button>
      </form>
    </div>
  );
}
