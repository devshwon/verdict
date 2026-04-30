import { Top } from "@toss/tds-mobile";
import { useMemo, useState } from "react";
import { AppShell } from "../../components/AppShell";
import {
  TODAY_CARD_CATEGORIES,
  fontSize,
  palette,
  spacing,
  type CategoryKey,
} from "../../design/tokens";
import { AdBanner } from "./components/AdBanner";
import { CategoryTabs } from "./components/CategoryTabs";
import { FeedCard } from "./components/FeedCard";
import { PastTodayCarousel } from "./components/PastTodayCarousel";
import { TodayVoteCard } from "./components/TodayVoteCard";
import { feedVotes, getRecentPastVotes, todayVotes } from "./mocks";
import type { TodayVote } from "./types";

export function HomeFeed() {
  const [active, setActive] = useState<CategoryKey>("all");

  const filteredFeed = useMemo(() => {
    if (active === "all") return feedVotes;
    return feedVotes.filter((v) => v.category === active);
  }, [active]);

  const todayVote: TodayVote | null =
    active !== "all" &&
    active !== "etc" &&
    TODAY_CARD_CATEGORIES.includes(active)
      ? todayVotes[active]
      : null;

  const carouselItems = getRecentPastVotes(active);

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

      <CategoryTabs active={active} onChange={setActive} />

      {todayVote ? <TodayVoteCard vote={todayVote} /> : null}

      <PastTodayCarousel items={carouselItems} />

      {filteredFeed.length === 0 ? (
        <EmptyState />
      ) : (
        filteredFeed.map((vote) => <FeedCard key={vote.id} vote={vote} />)
      )}
    </AppShell>
  );
}

function EmptyState() {
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
      표시할 투표가 없어요.
    </div>
  );
}
