import { useEffect, useState } from "react";
import { api, setToken, type ScStatus, type UserInfo } from "../api.ts";
import { worldChanged } from "../util.tsx";
import {
  DEFAULT_PREFS,
  setPrefs,
  usePrefs,
  type IntervalKey,
  type RangeKey,
} from "../settings.ts";

const RANGE_CHOICES: RangeKey[] = ["1W", "1M", "3M", "All"];
const INTERVAL_CHOICES: { key: IntervalKey; hint: string }[] = [
  { key: "auto", hint: "fits the window" },
  { key: "1h", hint: "hourly" },
  { key: "4h", hint: "4 hours" },
  { key: "12h", hint: "half-day" },
  { key: "1D", hint: "daily" },
  { key: "1W", hint: "weekly" },
];

function Choice<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="row" style={{ gap: 5, flexWrap: "wrap" }}>
      {options.map((o) => (
        <button
          key={o}
          className={`chip${value === o ? " won" : ""}`}
          style={{ cursor: "pointer", background: value === o ? undefined : "transparent" }}
          onClick={() => onChange(o)}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

/** SoundCloud account link — lives here now that Settings exists. */
function SoundCloudRow() {
  const [status, setStatus] = useState<ScStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.get<ScStatus>("/api/me/soundcloud").then(setStatus).catch(() => setStatus(null));
  }, []);
  if (!status) return null;

  const connect = async () => {
    setBusy(true);
    try {
      const { url } = await api.get<{ url: string }>("/api/auth/soundcloud/connect");
      window.location.href = url;
    } catch {
      setBusy(false);
    }
  };
  const disconnect = async () => {
    setBusy(true);
    await api.delete("/api/me/soundcloud");
    setStatus({ connected: false });
    setBusy(false);
  };

  return (
    <div className="row" style={{ justifyContent: "space-between" }}>
      <div>
        <b>☁️ SoundCloud</b>
        <p className="sub" style={{ margin: 0 }}>
          {status.connected
            ? `Connected as ${status.username ?? "your account"}`
            : "Connect to pick straight from your likes"}
        </p>
      </div>
      {status.connected ? (
        <button className="btn small danger" disabled={busy} onClick={() => void disconnect()}>
          Disconnect
        </button>
      ) : (
        <button className="btn small" disabled={busy} onClick={() => void connect()}>
          Connect
        </button>
      )}
    </div>
  );
}

export function Settings({ me }: { me: UserInfo }) {
  const prefs = usePrefs();

  return (
    <div>
      <h1 className="h1">Settings</h1>

      <div className="card section">
        <h2 className="h2">Chart defaults</h2>
        <p className="sub" style={{ marginTop: 0 }}>
          How every track chart opens. You can still change range and interval on any chart.
        </p>

        <div style={{ marginTop: 14 }}>
          <div className="sub" style={{ marginBottom: 5 }}>Default range</div>
          <Choice
            options={RANGE_CHOICES}
            value={prefs.defaultRange}
            onChange={(v) => setPrefs({ defaultRange: v })}
          />
        </div>

        <div style={{ marginTop: 14 }}>
          <div className="sub" style={{ marginBottom: 5 }}>
            Interval — {INTERVAL_CHOICES.find((i) => i.key === prefs.interval)?.hint}
          </div>
          <Choice
            options={INTERVAL_CHOICES.map((i) => i.key)}
            value={prefs.interval}
            onChange={(v) => setPrefs({ interval: v })}
          />
          <p className="sub" style={{ fontSize: 11, marginBottom: 0, marginTop: 6 }}>
            Coarser intervals smooth the line; finer ones show every wobble. Data is captured
            every few hours, so intervals below that show the raw points.
          </p>
        </div>

        <div className="row" style={{ justifyContent: "space-between", marginTop: 16 }}>
          <div>
            <b style={{ fontSize: 14 }}>Volume panel</b>
            <p className="sub" style={{ margin: 0 }}>Plays added per interval, under the line.</p>
          </div>
          <button
            className={`btn small${prefs.showVolume ? "" : " ghost"}`}
            onClick={() => setPrefs({ showVolume: !prefs.showVolume })}
          >
            {prefs.showVolume ? "On" : "Off"}
          </button>
        </div>

        <button
          className="btn ghost small"
          style={{ marginTop: 16 }}
          onClick={() => setPrefs(DEFAULT_PREFS)}
        >
          Reset to defaults
        </button>
      </div>

      <div className="card section">
        <h2 className="h2">Connections</h2>
        <SoundCloudRow />
      </div>

      <div className="card section">
        <h2 className="h2">Account</h2>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="sub">Handle</span>
          <b>@{me.handle}</b>
        </div>
        <div className="row" style={{ justifyContent: "space-between", marginTop: 6 }}>
          <span className="sub">Email</span>
          <span className="num">{me.email}</span>
        </div>
        <div className="row" style={{ justifyContent: "space-between", marginTop: 6 }}>
          <span className="sub">Timezone</span>
          <span className="num">{me.tz}</span>
        </div>
        <button
          className="btn ghost"
          style={{ marginTop: 16 }}
          onClick={() => {
            void api.post("/api/auth/logout").finally(() => {
              setToken(null);
              worldChanged();
            });
          }}
        >
          Log out
        </button>
      </div>
    </div>
  );
}
