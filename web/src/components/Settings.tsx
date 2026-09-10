import { useEffect, useState } from "react";
import { api, setToken, type ConnectionInfo, type UserInfo } from "../api.ts";
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

/**
 * Every linkable platform, driven by /api/me/connections rather than one
 * hardcoded row per provider. A user can hold ANY combination at once —
 * connected_accounts is keyed (user_id, provider) — and adding Apple Music
 * later needs no change here at all.
 */
const PROVIDER_ICON: Record<string, string> = {
  soundcloud: "☁️",
  spotify: "🟢",
  applemusic: "🍎",
};

const PROVIDER_BLURB: Record<string, string> = {
  soundcloud: "Pick straight from your likes",
  spotify: "Read your top artists and genres — powers your taste profile",
};

function ConnectionRow({ p, onChange }: { p: ConnectionInfo; onChange: () => void }) {
  const [busy, setBusy] = useState(false);

  const connect = async () => {
    setBusy(true);
    try {
      const { url } = await api.get<{ url: string }>(`/api/auth/${p.provider}/connect`);
      window.location.href = url;
    } catch {
      setBusy(false);
    }
  };
  const disconnect = async () => {
    setBusy(true);
    await api.delete(`/api/me/${p.provider}`);
    setBusy(false);
    onChange();
  };

  return (
    <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
      <div style={{ minWidth: 0 }}>
        <b>
          {PROVIDER_ICON[p.provider] ?? "🎵"} {p.label}
        </b>
        <p className="sub" style={{ margin: 0 }}>
          {!p.configured
            ? "Not configured on this server"
            : p.connected
              ? `Connected as ${p.username ?? "your account"}`
              : (PROVIDER_BLURB[p.provider] ?? "Connect this account")}
        </p>
      </div>
      {p.connected ? (
        <button className="btn small danger" disabled={busy} onClick={() => void disconnect()}>
          Disconnect
        </button>
      ) : (
        <button className="btn small" disabled={busy || !p.configured} onClick={() => void connect()}>
          Connect
        </button>
      )}
    </div>
  );
}

function ConnectionsCard() {
  const [providers, setProviders] = useState<ConnectionInfo[] | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    void api
      .get<{ providers: ConnectionInfo[] }>("/api/me/connections")
      .then((d) => setProviders(d.providers))
      .catch(() => setProviders(null));
  }, [tick]);

  if (!providers) return null;
  const linked = providers.filter((p) => p.connected).length;

  return (
    <div className="card section">
      <h2 className="h2">Connected accounts</h2>
      <p className="sub" style={{ marginTop: 0 }}>
        {linked > 1
          ? "Linking more than one sharpens your taste profile — where they agree is the strongest signal."
          : "Link more than one and we can tell what you actually listen to, not just what one app sees."}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 12 }}>
        {providers.map((p) => (
          <ConnectionRow key={p.provider} p={p} onChange={() => setTick((t) => t + 1)} />
        ))}
      </div>
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
          <div className="sub" style={{ marginBottom: 5 }}>
            Default view —{" "}
            {prefs.mode === "momentum"
              ? "plays per day; falls when a track cools off"
              : prefs.mode === "relative"
                ? "plays ÷ your entry — the multiple that scales your points"
                : "running play count; only ever rises"}
          </div>
          <Choice
            options={["total", "momentum", "relative"] as const}
            value={prefs.mode}
            onChange={(v) => setPrefs({ mode: v })}
          />
          <p className="sub" style={{ fontSize: 11, marginBottom: 0, marginTop: 6 }}>
            "relative" shows how many times over the track has grown since you picked it —
            which is exactly the multiplier your points are scaled by.
          </p>
          {prefs.mode === "relative" && (
            <div style={{ marginTop: 10 }}>
              <div className="sub" style={{ marginBottom: 5 }}>
                vs-pace axis —{" "}
                {prefs.relativeScale === "linear"
                  ? "peak-scaled: spikes tower, but everything below pace crowds the floor"
                  : "centred on the benchmark, equal room above and below"}
              </div>
              <Choice
                options={["linear", "log"] as const}
                value={prefs.relativeScale}
                onChange={(v) => setPrefs({ relativeScale: v })}
              />
            </div>
          )}
        </div>

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
        <ConnectionsCard />
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
