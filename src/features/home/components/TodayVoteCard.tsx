import { Button } from "@toss/tds-mobile";
import { useNavigate } from "react-router-dom";
import {
  borderWidth,
  categories,
  categoryColors,
  fontSize,
  fontWeight,
  lineHeight,
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
      onClick={goDetail}
      style={{
        margin: `${spacing.sm}px ${spacing.lg}px`,
        padding: spacing.lg,
        borderRadius: radius.lg,
        border: `${borderWidth.thick}px solid ${color.bar}`,
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
            fontSize: fontSize.caption,
            fontWeight: fontWeight.medium,
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
          fontSize: fontSize.title,
          fontWeight: fontWeight.bold,
          color: palette.textPrimary,
          lineHeight: lineHeight.tight,
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
        <span
          style={{
            fontSize: fontSize.label,
            fontWeight: fontWeight.medium,
            color: color.bar,
          }}
        >
          {vote.remainingLabel}
        </span>
        <span style={{ fontSize: fontSize.small, color: palette.textSecondary }}>
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
