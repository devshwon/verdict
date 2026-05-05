import { useNavigate } from "react-router-dom";
import {
  fontSize,
  fontWeight,
  palette,
  spacing,
} from "../../../design/tokens";
import { PastVoteCard } from "../../today-archive/components/PastVoteCard";
import type { PastTodayVote } from "../types";

type Props = {
  items: PastTodayVote[];
};

export function PastTodayCarousel({ items }: Props) {
  const navigate = useNavigate();

  return (
    <section
      style={{
        margin: `${spacing.md}px 0 ${spacing.sm}px`,
        display: "flex",
        flexDirection: "column",
        gap: spacing.sm,
      }}
    >
      <header
        style={{
          padding: `0 ${spacing.lg}px`,
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: fontSize.subtitle,
            fontWeight: fontWeight.bold,
            color: palette.textPrimary,
          }}
        >
          지난 오늘의 투표
        </h2>
        <button
          type="button"
          onClick={() => navigate("/today/archive")}
          style={{
            background: "transparent",
            border: 0,
            padding: 0,
            fontSize: fontSize.label,
            fontWeight: fontWeight.medium,
            color: palette.textSecondary,
            cursor: "pointer",
          }}
        >
          전체 보기
        </button>
      </header>

      {items.length === 0 ? (
        <CarouselEmpty />
      ) : (
        <div
          style={{
            display: "flex",
            gap: spacing.md,
            padding: `${spacing.xs}px ${spacing.lg}px`,
            overflowX: "auto",
            WebkitOverflowScrolling: "touch",
            scrollSnapType: "x mandatory",
          }}
        >
          {items.map((item) => (
            <PastVoteCard key={item.id} vote={item} variant="carousel" />
          ))}
        </div>
      )}
    </section>
  );
}

function CarouselEmpty() {
  return (
    <div
      style={{
        margin: `0 ${spacing.lg}px`,
        padding: spacing.lg,
        textAlign: "center",
        color: palette.textSecondary,
        fontSize: fontSize.label,
      }}
    >
      이 카테고리에는 아직 지난 투표가 없어요.
    </div>
  );
}
