import { Button } from "@toss/tds-mobile";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { UnlockConfirmDialog } from "../../../components/UnlockConfirmDialog";
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
  const { isUnlocked, isPending, unlock, freePassBalance } = useUnlock();
  const [confirmOpen, setConfirmOpen] = useState(false);
  // 두 소스 합집합: 서버 fetch(vote.unlocked) ∪ 이번 세션 unlock(isUnlocked).
  // 마운트 직후 UnlockProvider hydrate 전 짧은 윈도우에 vote.unlocked로 즉시 반영.
  const unlocked = isUnlocked(vote.id) || vote.unlocked;
  const pending = isPending(vote.id);
  const color = categoryColors[vote.category];
  const categoryLabel =
    categories.find((c) => c.key === vote.category)?.label ?? "";

  const goDetail = () => navigate(`/vote/${vote.id}`);
  const handleUnlock = () => {
    if (pending || unlocked) return;
    if (freePassBalance > 0) {
      setConfirmOpen(true);
      return;
    }
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
          {unlocked
            ? "결과 보기"
            : freePassBalance > 0
              ? "결과 열기"
              : "광고 보고 열기"}
        </Button>
      </div>

      <UnlockConfirmDialog
        open={confirmOpen}
        freePassBalance={freePassBalance}
        onUseFreePass={() => unlock(vote.id)}
        onWatchAd={() => unlock(vote.id, { forceAd: true })}
        onClose={() => setConfirmOpen(false)}
      />
    </article>
  );
}
