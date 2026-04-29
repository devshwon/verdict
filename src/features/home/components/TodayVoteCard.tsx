import { Button } from "@toss/tds-mobile";
import { useNavigate } from "react-router-dom";
import {
  categories,
  categoryColors,
  palette,
  radius,
  spacing,
  todayTagStyle,
} from "../../../design/tokens";
import type { TodayVote } from "../types";

type Props = {
  vote: TodayVote;
};

export function TodayVoteCard({ vote }: Props) {
  const navigate = useNavigate();
  const goDetail = () => navigate(`/vote/${vote.id}`);
  const color = categoryColors[vote.category];
  const categoryLabel =
    categories.find((c) => c.key === vote.category)?.label ?? "";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={goDetail}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          goDetail();
        }
      }}
      style={{
        margin: `${spacing.sm}px ${spacing.lg}px`,
        padding: spacing.lg,
        borderRadius: radius.lg,
        border: `1.5px solid ${color.bar}`,
        background: color.surface,
        display: "flex",
        flexDirection: "column",
        gap: spacing.sm,
        cursor: "pointer",
      }}
    >
      <div style={{ display: "flex", gap: spacing.xs }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: `${spacing.xs}px ${spacing.sm}px`,
            borderRadius: radius.sm,
            background: todayTagStyle.surface,
            color: todayTagStyle.text,
          }}
        >
          {todayTagStyle.label} · {categoryLabel}
        </span>
      </div>

      <div
        style={{
          fontSize: 17,
          fontWeight: 700,
          color: palette.textPrimary,
          lineHeight: 1.4,
        }}
      >
        “{vote.question}”
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: color.bar }}>
          {vote.remainingLabel}
        </span>
        <span style={{ fontSize: 12, color: palette.textSecondary }}>
          {vote.participants.toLocaleString()}명 참여
        </span>
      </div>

      <Button
        variant="fill"
        size="medium"
        onClick={(e) => {
          e.stopPropagation();
          goDetail();
        }}
      >
        투표하기
      </Button>
    </div>
  );
}
