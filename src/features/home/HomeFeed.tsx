import { Top } from "@toss/tds-mobile";
import { useCallback, useEffect, useState } from "react";
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

export function HomeFeed() {
  const [active, setActive] = useState<CategoryKey>("all");
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [feed, setFeed] = useState<FeedVote[]>([]);
  const [today, setToday] = useState<TodayVote | null>(null);
  const [past, setPast] = useState<PastTodayVote[]>([]);
  const [missions, setMissions] = useState<DailyMissions | null>(null);

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
  }, [active, load]);

  const handleCastSuccess = useCallback(() => {
    void load(active);
  }, [active, load]);

  return (
    <AppShell footer={<AdBanner />}>
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
            feed.map((vote) => (
              <FeedCard
                key={vote.id}
                vote={vote}
                onCastSuccess={handleCastSuccess}
              />
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
