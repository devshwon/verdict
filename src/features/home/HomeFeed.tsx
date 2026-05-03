import { Top } from "@toss/tds-mobile";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "../../components/AppShell";
import {
  TODAY_CARD_CATEGORIES,
  fontSize,
  palette,
  spacing,
  type CategoryKey,
} from "../../design/tokens";
import {
  fetchFeedVotes,
  fetchPastTodayVotes,
  fetchTodayVote,
  getDailyMissions,
  type DailyMissions,
} from "../../lib/db/votes";
import { AdBanner } from "./components/AdBanner";
import { CategoryTabs } from "./components/CategoryTabs";
import { FeedCard } from "./components/FeedCard";
import { MissionWidget } from "./components/MissionWidget";
import { PastTodayCarousel } from "./components/PastTodayCarousel";
import { TodayVoteCard } from "./components/TodayVoteCard";
import type { FeedVote, PastTodayVote, TodayVote } from "./types";

type Status = "loading" | "ready" | "error";

const SS_ACTIVE = "home_feed_active";
const SS_SCROLL = "home_feed_scroll";

const VALID_CATEGORIES: ReadonlySet<CategoryKey> = new Set([
  "all",
  "daily",
  "love",
  "work",
  "game",
  "etc",
]);

function readActiveFromStorage(): CategoryKey {
  try {
    const v = sessionStorage.getItem(SS_ACTIVE);
    if (v && VALID_CATEGORIES.has(v as CategoryKey)) return v as CategoryKey;
  } catch {
    // storage 비활성 환경 fallback
  }
  return "all";
}

const AD_INTERVAL = 5; // N장마다 인라인 배너 1개

/** 현재 KST 일자(YYYY-MM-DD) 문자열. 자정 변경 감지에 사용 */
function kstDateString(): string {
  const now = new Date();
  // KST = UTC+9. now() 그대로 +9h 한 시각의 YYYY-MM-DD
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

export function HomeFeed() {
  const [active, setActive] = useState<CategoryKey>(readActiveFromStorage);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [feed, setFeed] = useState<FeedVote[]>([]);
  const [today, setToday] = useState<TodayVote | null>(null);
  const [past, setPast] = useState<PastTodayVote[]>([]);
  const [missions, setMissions] = useState<DailyMissions | null>(null);

  const mainRef = useRef<HTMLElement>(null);
  const firstMountRef = useRef(true);
  const scrollRestoredRef = useRef(false);
  const writeScrollRafRef = useRef<number | null>(null);
  const missionDateRef = useRef<string>(kstDateString());

  const refreshMissions = useCallback(async () => {
    try {
      const m = await getDailyMissions();
      setMissions(m);
      missionDateRef.current = kstDateString();
    } catch (e) {
      console.error("[HomeFeed] missions refresh failed:", e);
    }
  }, []);

  const load = useCallback(async (cat: CategoryKey) => {
    setStatus("loading");
    setError(null);
    try {
      const showsTodayCard =
        cat !== "all" &&
        cat !== "etc" &&
        TODAY_CARD_CATEGORIES.includes(cat);

      const [feedRes, todayRes, pastRes, missionsRes] = await Promise.all([
        fetchFeedVotes(cat),
        showsTodayCard
          ? fetchTodayVote(cat as Exclude<CategoryKey, "all" | "etc">)
          : Promise.resolve(null),
        fetchPastTodayVotes(cat),
        getDailyMissions().catch((e) => {
          console.error("[HomeFeed] missions load failed:", e);
          return null;
        }),
      ]);
      setFeed(feedRes);
      setToday(todayRes);
      setPast(pastRes);
      setMissions(missionsRes);
      setStatus("ready");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[HomeFeed] load failed:", msg);
      setError(msg);
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void load(active);
    try {
      sessionStorage.setItem(SS_ACTIVE, active);
    } catch {
      // ignore
    }
    // 카테고리 "변경"인 경우만 이전 스크롤 무효화 (첫 마운트 복원은 보존)
    if (!firstMountRef.current) {
      scrollRestoredRef.current = true; // 변경 후 추가 복원 불필요
      try {
        sessionStorage.removeItem(SS_SCROLL);
      } catch {
        // ignore
      }
      if (mainRef.current) mainRef.current.scrollTop = 0;
    }
    firstMountRef.current = false;
  }, [active, load]);

  // 첫 마운트의 첫 ready 시 1회 스크롤 복원
  useEffect(() => {
    if (status !== "ready") return;
    if (scrollRestoredRef.current) return;
    scrollRestoredRef.current = true;
    try {
      const saved = sessionStorage.getItem(SS_SCROLL);
      const top = saved ? parseInt(saved, 10) : 0;
      if (top > 0 && mainRef.current) {
        mainRef.current.scrollTop = top;
      }
    } catch {
      // ignore
    }
  }, [status]);

  // KST 자정 넘어가면 미션 재조회 (앱 백그라운드 → 포그라운드, 또는 앱 계속 켜놓고 자정 통과 케이스)
  useEffect(() => {
    const checkDayChange = () => {
      const today = kstDateString();
      if (today !== missionDateRef.current) {
        missionDateRef.current = today;
        void refreshMissions();
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        checkDayChange();
        // 잔량(무료이용권 등)이 다른 화면에서 변경됐을 수도 있어 가벼운 refetch
        void refreshMissions();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    const intervalId = window.setInterval(checkDayChange, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(intervalId);
    };
  }, [refreshMissions]);

  // 스크롤 위치 추적 — rAF로 throttle
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const onScroll = () => {
      if (writeScrollRafRef.current !== null) return;
      writeScrollRafRef.current = window.requestAnimationFrame(() => {
        writeScrollRafRef.current = null;
        try {
          sessionStorage.setItem(SS_SCROLL, String(el.scrollTop));
        } catch {
          // ignore
        }
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (writeScrollRafRef.current !== null) {
        window.cancelAnimationFrame(writeScrollRafRef.current);
        writeScrollRafRef.current = null;
      }
    };
  }, []);

  return (
    <AppShell mainRef={mainRef}>
      <Top
        title={
          <Top.TitleParagraph size={fontSize.hero}>판정단</Top.TitleParagraph>
        }
        subtitleBottom={
          <Top.SubtitleParagraph size={fontSize.subtitle}>
            대중의 평균값이 궁금할 때
          </Top.SubtitleParagraph>
        }
      />

      <MissionWidget missions={missions} />

      <CategoryTabs active={active} onChange={setActive} />

      {status === "loading" ? (
        <FeedMessage>불러오는 중…</FeedMessage>
      ) : status === "error" ? (
        <FeedMessage>
          불러오기에 실패했어요{error ? ` (${error})` : ""}
        </FeedMessage>
      ) : (
        <>
          {today ? <TodayVoteCard vote={today} /> : null}
          <PastTodayCarousel items={past} />
          {feed.length === 0 ? (
            <FeedMessage>표시할 투표가 없어요.</FeedMessage>
          ) : (
            feed.map((vote, i) => (
              <Fragment key={vote.id}>
                <FeedCard vote={vote} />
                {/* 5장마다 인라인 배너 (1번째·2번째·…·5번째 카드 다음) — 5장 미만 피드면 광고 미삽입 */}
                {(i + 1) % AD_INTERVAL === 0 && i + 1 < feed.length ? (
                  <AdBanner />
                ) : null}
              </Fragment>
            ))
          )}
        </>
      )}
    </AppShell>
  );
}

function FeedMessage({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        margin: `${spacing.xl}px ${spacing.lg}px`,
        padding: spacing.xl,
        textAlign: "center",
        color: palette.textSecondary,
        fontSize: fontSize.body,
      }}
    >
      {children}
    </div>
  );
}
