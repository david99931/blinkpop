import { useEffect, useState } from "react";
import { api, currentUserId, setCurrentUserId, type NotificationsData, type UserInfo } from "./api.ts";
import { useRoute, useWorldVersion } from "./util.tsx";
import { Onboarding } from "./components/Onboarding.tsx";
import { Home } from "./components/Home.tsx";
import { TrackPage } from "./components/TrackPage.tsx";
import { Portfolio } from "./components/Portfolio.tsx";
import { Feed } from "./components/Feed.tsx";
import { Leaderboard } from "./components/Leaderboard.tsx";
import { Inbox } from "./components/Inbox.tsx";
import { WarpControl } from "./components/WarpControl.tsx";

export default function App() {
  const route = useRoute();
  const world = useWorldVersion();
  const [me, setMe] = useState<UserInfo | null | undefined>(undefined); // undefined = loading
  const [unread, setUnread] = useState(0);
  const [simDay, setSimDay] = useState<number | null>(null);

  useEffect(() => {
    if (currentUserId() === null) {
      setMe(null);
      return;
    }
    api
      .get<UserInfo>("/api/me")
      .then(setMe)
      .catch(() => {
        setCurrentUserId(null); // stale id (e.g. DB reset)
        setMe(null);
      });
  }, [world]);

  useEffect(() => {
    if (!me) return;
    void api.get<NotificationsData>("/api/notifications").then((d) => setUnread(d.unreadCount));
    void api.get<{ simDay: number }>("/api/dev/clock").then((d) => setSimDay(d.simDay));
  }, [me, world]);

  if (me === undefined) return null;
  if (me === null) {
    return (
      <div className="main">
        <Onboarding />
      </div>
    );
  }

  const page = route[0] ?? "";
  const view =
    page === "track" && route[1] ? <TrackPage id={route[1]} />
    : page === "u" && route[1] ? <Portfolio handle={route[1]} myHandle={me.handle} />
    : page === "feed" ? <Feed />
    : page === "board" ? <Leaderboard />
    : page === "inbox" ? <Inbox />
    : <Home handle={me.handle} />;

  const tab = (p: string) => (page === p ? "active" : "");

  return (
    <>
      <header className="topbar">
        <a className="logo" href="#/">
          First<em>Fan</em>
        </a>
        {simDay !== null && <span className="daypill num">Day {simDay}</span>}
        <span className="spacer" />
        <a className="bell" href="#/inbox" aria-label={`Inbox, ${unread} unread`}>
          🔔
          {unread > 0 && <span className="badge num">{unread > 9 ? "9+" : unread}</span>}
        </a>
        <button
          className="bell"
          title={`Signed in as @${me.handle} — click to switch`}
          onClick={() => {
            setCurrentUserId(null);
            setMe(null);
          }}
        >
          @
        </button>
      </header>

      <main className="main">{view}</main>

      <WarpControl />

      <nav className="tabbar">
        <a className={page === "" || page === "track" ? "active" : ""} href="#/">
          <span className="ico">🎯</span>Pick
        </a>
        <a className={tab("feed")} href="#/feed">
          <span className="ico">📡</span>Feed
        </a>
        <a className={tab("board")} href="#/board">
          <span className="ico">🏆</span>Board
        </a>
        <a className={page === "u" && route[1] === me.handle ? "active" : ""} href={`#/u/${me.handle}`}>
          <span className="ico">📁</span>Portfolio
        </a>
      </nav>
    </>
  );
}
