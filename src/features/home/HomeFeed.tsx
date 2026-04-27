import { Top } from "@toss/tds-mobile";
import { Fragment, useMemo, useState } from "react";
import {
  TODAY_CARD_CATEGORIES,
  palette,
  spacing,
  type CategoryKey,
} from "../../design/tokens";
import { AdBanner } from "./components/AdBanner";
import { CategoryTabs } from "./components/CategoryTabs";
import { FeedCard } from "./components/FeedCard";
import { TodayVoteCard } from "./components/TodayVoteCard";
import { feedVotes, todayVotes } from "./mocks";
import type { TodayVote } from "./types";

const AD_INSERT_INDEX = 2;

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

  return (
    <div
      style={{
        background: palette.surface,
        minHeight: "100vh",
        paddingBottom: spacing.xxl,
      }}
    >
      <Top
        title={<Top.TitleParagraph size={22}>판정단</Top.TitleParagraph>}
        subtitleBottom={
          <Top.SubtitleParagraph size={15}>
            대중의 평균값이 궁금할 때
          </Top.SubtitleParagraph>
        }
      />

      <CategoryTabs active={active} onChange={setActive} />

      {todayVote ? <TodayVoteCard vote={todayVote} /> : null}

      {filteredFeed.length === 0 ? (
        <EmptyState />
      ) : (
        filteredFeed.map((vote, idx) => (
          <Fragment key={vote.id}>
            <FeedCard vote={vote} />
            {idx === AD_INSERT_INDEX ? <AdBanner /> : null}
          </Fragment>
        ))
      )}
    </div>
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
        fontSize: 14,
      }}
    >
      표시할 투표가 없어요.
    </div>
  );
}
