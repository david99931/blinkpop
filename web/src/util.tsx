import { useEffect, useState } from "react";

/** 3204 → "3.2k", 1200000 → "1.2M" */
export function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const v = n / 1000;
    return `${v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, "")}k`;
  }
  const v = n / 1_000_000;
  return `${v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, "")}M`;
}

export function fmtPts(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Deterministic two-color gradient per track id — the mock "artwork". */
export function artStyle(id: string): { background: string } {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const h1 = h % 360;
  const h2 = (h1 + 40 + (h % 80)) % 360;
  return {
    background: `linear-gradient(135deg, hsl(${h1} 45% 38%), hsl(${h2} 55% 26%))`,
  };
}

export function Artwork({
  id,
  title,
  large,
  url,
}: {
  id: string;
  title: string;
  large?: boolean;
  url?: string | null;
}) {
  if (url) {
    return (
      <img
        className={`art${large ? " lg" : ""}`}
        src={url}
        alt=""
        loading="lazy"
        style={{ objectFit: "cover" }}
      />
    );
  }
  return (
    <div className={`art${large ? " lg" : ""}`} style={artStyle(id)} aria-hidden>
      {title.charAt(0).toUpperCase()}
    </div>
  );
}

export function TierBadge({ label, multiplier }: { label: string; multiplier: number }) {
  return (
    <span className={`tier${multiplier >= 5 ? " hot" : ""}`}>
      {multiplier >= 5 ? "🔥 " : ""}
      {label} · {multiplier}×
    </span>
  );
}

/** Minimal hash router: "#/track/mock-0001" → ["track", "mock-0001"]. */
export function useRoute(): string[] {
  const parse = () => window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const [route, setRoute] = useState<string[]>(parse);
  useEffect(() => {
    const onChange = () => setRoute(parse());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export function navigate(path: string): void {
  window.location.hash = path;
}

/** Bump-key that increments whenever something (warp, pick) changed the world. */
export function useWorldVersion(): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    const bump = () => setV((x) => x + 1);
    window.addEventListener("ff:world-changed", bump);
    return () => window.removeEventListener("ff:world-changed", bump);
  }, []);
  return v;
}

export function worldChanged(): void {
  window.dispatchEvent(new Event("ff:world-changed"));
}
