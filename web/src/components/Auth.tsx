import { useState } from "react";
import { api, setToken, type AuthResult } from "../api.ts";
import { worldChanged } from "../util.tsx";

export function Auth() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [handle, setHandle] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result =
        mode === "signup"
          ? await api.post<AuthResult>("/api/auth/signup", {
              handle,
              email,
              password,
              tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
            })
          : await api.post<AuthResult>("/api/auth/login", { identifier, password });
      setToken(result.token);
      worldChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const canSubmit =
    password.length >= 8 && (mode === "signup" ? handle && email : identifier);

  return (
    <div>
      <h1 className="h1">
        Call it <em style={{ color: "var(--accent)", fontStyle: "normal" }}>before</em> it blows up.
      </h1>
      <p className="sub">One pick a day. Points while your call grows.</p>

      <div className="howcards section">
        <div className="card">
          <div className="n">1</div>
          <div>
            <b>Pick one song a day</b>
            <p className="sub">Lock it in. No edits, no take-backs.</p>
          </div>
        </div>
        <div className="card">
          <div className="n">2</div>
          <div>
            <b>Earn as it grows</b>
            <p className="sub">Unknown artists pay 10× — hits pay almost nothing.</p>
          </div>
        </div>
        <div className="card">
          <div className="n">3</div>
          <div>
            <b>Climb the board</b>
            <p className="sub">Your portfolio is the proof you heard it first.</p>
          </div>
        </div>
      </div>

      <div className="section card">
        <div className="tabs" style={{ marginBottom: 14 }}>
          <button className={mode === "login" ? "on" : ""} onClick={() => setMode("login")}>
            Log in
          </button>
          <button className={mode === "signup" ? "on" : ""} onClick={() => setMode("signup")}>
            Sign up
          </button>
        </div>
        <div className="stack">
          {mode === "signup" ? (
            <>
              <input
                className="input"
                placeholder="handle (a–z, 0–9, _)"
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
              />
              <input
                className="input"
                placeholder="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </>
          ) : (
            <input
              className="input"
              placeholder="handle or email"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
            />
          )}
          <input
            className="input"
            placeholder="password (8+ characters)"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && canSubmit && void submit()}
          />
          <button className="btn" disabled={busy || !canSubmit} onClick={() => void submit()}>
            {busy ? "…" : mode === "signup" ? "Start picking" : "Log in"}
          </button>
        </div>
        {error && <p className="err">{error}</p>}
      </div>
    </div>
  );
}
