import { Button } from "@toss/tds-mobile";
import { useNavigate } from "react-router-dom";
import {
  LOCKED_QUESTION_MASK,
  blur,
  borderWidth,
  categories,
  categoryColors,
  fontSize,
  fontWeight,
  layout,
  lineHeight,
  palette,
  radius,
  spacing,
} from "../../../design/tokens";
import type { PastTodayVote } from "../../home/types";
import { useUnlock } from "../unlockContextValue";

type Variant = "carousel" | "row";

type Props = {
  vote: PastTodayVote;
  variant: Variant;
};

export function PastVoteCard({ vote, variant }: Props) {
  const navigate = useNavigate();
  const { isUnlocked, isPending, unlock } = useUnlock();
  // FIXME: mock 한정. API 연동 시 vote.unlocked 필드를 응답에서 제거하고
  // App.tsx의 UnlockProvider에 initialUnlockedIds로 hydrate해 단일 원천으로 만들 것.
  const unlocked = isUnlocked(vote.id) || vote.unlocked;
  const pending = isPending(vote.id);
  const color = categoryColors[vote.category];
  const categoryLabel =
    categories.find((c) => c.key === vote.category)?.label ?? "";

  const goDetail = () => navigate(`/vote/${vote.id}`);
  const handleUnlock = () => {
    if (pending || unlocked) return;
    void unlock(vote.id);
  };

  const isCarousel = variant === "carousel";

  return (
    <article
      onClick={unlocked ? goDetail : undefined}
      style={{
        flex: isCarousel ? `0 0 ${layout.pastVoteCardWidth}px` : "1 1 auto",
        scrollSnapAlign: isCarousel ? "start" : undefined,
        padding: spacing.md,
        borderRadius: radius.lg,
        border: `${borderWidth.hairline}px solid ${palette.border}`,
        background: palette.background,
        display: "flex",
        flexDirection: "column",
        gap: spacing.sm,
        cursor: unlocked ? "pointer" : "default",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span
          style={{
            fontSize: fontSize.caption,
            fontWeight: fontWeight.medium,
            padding: `${spacing.xs}px ${spacing.sm}px`,
            borderRadius: radius.sm,
            background: color.surface,
            color: color.text,
          }}
        >
          {categoryLabel}
        </span>
        <span
          style={{
            fontSize: fontSize.caption,
            color: palette.textTertiary,
          }}
        >
          {vote.endedAt}
        </span>
      </div>

      <p
        aria-hidden={!unlocked}
        style={{
          margin: 0,
          fontSize: fontSize.body,
          fontWeight: fontWeight.bold,
          color: unlocked ? palette.textPrimary : palette.textTertiary,
          lineHeight: lineHeight.tight,
          minHeight: layout.pastVoteQuestionMinHeight,
          filter: unlocked ? "none" : `blur(${blur.lock}px)`,
          userSelect: unlocked ? "auto" : "none",
        }}
      >
        “{unlocked ? vote.question : LOCKED_QUESTION_MASK}”
      </p>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: spacing.sm,
        }}
      >
        <span
          style={{
            fontSize: fontSize.small,
            color: palette.textSecondary,
          }}
        >
          {vote.participants.toLocaleString()}명 참여
        </span>

        <Button
          variant={unlocked ? "weak" : "fill"}
          size="small"
          loading={pending}
          disabled={pending}
          onClick={(e) => {
            e.stopPropagation();
            if (unlocked) goDetail();
            else handleUnlock();
          }}
        >
          {unlocked ? "결과 보기" : "광고 보고 열기"}
        </Button>
      </div>
    </article>
  );
}
