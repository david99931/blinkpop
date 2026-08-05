import { useEffect, useState } from "react";
import { api, setCurrentUserId, type UserInfo } from "../api.ts";
import { worldChanged } from "../util.tsx";

export function Onboarding() {
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [handle, setHandle] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadUsers = () =>
    api.get<{ users: UserInfo[] }>("/api/users").then((d) => setUsers(d.users));
  useEffect(() => {
    void loadUsers();
  }, []);

  const signIn = (id: number) => {
    setCurrentUserId(id);
    worldChanged();
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const user = await api.post<UserInfo>("/api/users", {
        handle,
        email,
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      signIn(user.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const seedDemo = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/dev/seed-demo");
      await loadUsers();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1 className="h1">
        Call it <em style={{ color: "var(--accent)", fontStyle: "normal" }}>before</em> it blows up.
      </h1>
      <p className="sub">One pick a day. Points when your call takes off.</p>

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
            <b>Earn when it blows up</b>
            <p className="sub">Tiny artists pay 10× — hits pay almost nothing.</p>
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
        <h2 className="h2">Create your account</h2>
        <div className="stack">
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
          <button className="btn" disabled={busy || !handle || !email} onClick={() => void create()}>
            Start picking
          </button>
        </div>
        {error && <p className="err">{error}</p>}
      </div>

      {users.length > 0 ? (
        <div className="section">
          <h2 className="h2">Or continue as</h2>
          <div className="stack">
            {users.map((u) => (
              <button key={u.id} className="btn ghost" onClick={() => signIn(u.id)}>
                @{u.handle}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="section">
          <button className="btn ghost" disabled={busy} onClick={() => void seedDemo()}>
            Load demo world (ava, ben, cleo)
          </button>
        </div>
      )}
    </div>
  );
}
