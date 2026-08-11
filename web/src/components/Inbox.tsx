import { useEffect, useState } from "react";
import { api, type NotificationsData } from "../api.ts";
import { fmt, fmtDate, fmtPts, worldChanged } from "../util.tsx";

function line(n: NotificationsData["notifications"][number]): string {
  const p = n.payload;
  switch (n.type) {
    case "milestone_crossed":
      return `${p.title} crossed ${fmt(p.milestoneValue as number)} plays 🚀`;
    case "weekly_growth_awarded":
      return `${p.title} had a breakout week 📈 +${fmtPts(p.points as number)} pts`;
    case "early_bird_awarded":
      return `Early bird on ${p.title} 🐦 — you were in before the crowd`;
    case "badge_upgraded":
      return `${p.title} upgraded to ${p.icon} ${p.badgeLabel} — a new badge for your shelf`;
    case "followed_user_picked":
      return `@${p.pickerHandle} locked in ${p.kind === "super" ? "a ⚡ super pick: " : ""}${p.title} — ${fmt(p.baselinePlays as number | null)} plays`;
    case "new_follower":
      return `@${p.followerHandle} started following you`;
    default:
      return n.type;
  }
}

export function Inbox() {
  const [data, setData] = useState<NotificationsData | null>(null);

  // Fetch once per mount (not on world changes — marking read bumps the world
  // version to refresh the bell badge, which must not refetch us in a loop).
  useEffect(() => {
    void api.get<NotificationsData>("/api/notifications").then((d) => {
      setData(d);
      if (d.unreadCount > 0) {
        void api.post("/api/notifications/read").then(() => worldChanged());
      }
    });
  }, []);

  if (!data) return <div className="empty">Loading…</div>;
  return (
    <div>
      <h1 className="h1">Inbox</h1>
      <div className="stack">
        {data.notifications.map((n) => (
          <div
            className="card"
            key={n.id}
            style={n.readAt === null ? { borderColor: "var(--accent)" } : undefined}
          >
            <div className="sub num">{fmtDate(n.createdAt)}</div>
            <div style={{ marginTop: 2 }}>{line(n)}</div>
          </div>
        ))}
        {data.notifications.length === 0 && <div className="empty">Nothing yet — go make a call.</div>}
      </div>
    </div>
  );
}
