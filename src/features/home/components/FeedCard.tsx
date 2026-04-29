import { Button } from "@toss/tds-mobile";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  borderWidth,
  categories,
  categoryColors,
  controlHeight,
  feedTagStyles,
  fontSize,
  fontWeight,
  lineHeight,
  palette,
  radius,
  spacing,
} from "../../../design/tokens";
import type { FeedVote, VoteOption } from "../types";

type Props = {
  vote: FeedVote;
};

export function FeedCard({ vote }: Props) {
  const navigate = useNavigate();
  const goDetail = () => navigate(`/vote/${vote.id}`);
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const cat = categoryColors[vote.category];
  const tag = feedTagStyles[vote.tag];
  const categoryLabel =
    categories.find((c) => c.key === vote.category)?.label ?? "";

  const [pendingId, setPendingId] = useState<string | null>(null);
  const [voted, setVoted] = useState(false);

  const showResults = vote.showResultBar || voted;
  const pendingOption =
    pendingId !== null
      ? vote.options.find((o) => o.id === pendingId) ?? null
      : null;

  return (
    <div
      onClick={goDetail}
      style={{
        margin: `${spacing.sm}px ${spacing.lg}px`,
        padding: spacing.lg,
        borderRadius: radius.lg,
        border: `${borderWidth.hairline}px solid ${palette.border}`,
        background: palette.background,
        display: "flex",
        flexDirection: "column",
        gap: spacing.sm,
        cursor: "pointer",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: spacing.xs,
        }}
      >
        <Pill bg={cat.surface} fg={cat.text}>
          {categoryLabel}
        </Pill>
        <Pill bg={tag.surface} fg={tag.text}>
          {tag.label}
        </Pill>
        <span
          style={{
            marginLeft: "auto",
            fontSize: fontSize.small,
            color: palette.textSecondary,
          }}
        >
          {vote.tag === "closed" || vote.tag === "popular"
            ? `${vote.participants.toLocaleString()}명 참여`
            : vote.remainingLabel}
        </span>
      </div>

      <div
        style={{
          fontSize: fontSize.subtitle,
          fontWeight: fontWeight.medium,
          color: palette.textPrimary,
          lineHeight: lineHeight.body,
        }}
      >
        “{vote.question}”
      </div>

      {showResults ? (
        <div
          style={{ display: "flex", flexDirection: "column", gap: spacing.xs }}
        >
          {voted ? (
            <span
              style={{
                fontSize: fontSize.small,
                fontWeight: fontWeight.medium,
                color: cat.bar,
              }}
            >
              참여 완료
            </span>
          ) : null}
          {vote.options.map((opt) => (
            <ResultBar
              key={opt.id}
              option={opt}
              barColor={opt.ratio >= 50 ? cat.bar : palette.textTertiary}
            />
          ))}
        </div>
      ) : (
        <div
          style={{ display: "flex", flexDirection: "column", gap: spacing.sm }}
        >
          <div style={{ display: "flex", gap: spacing.sm }}>
            {vote.options.map((opt) => {
              const isPending = pendingId === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={(e) => {
                    stop(e);
                    setPendingId((prev) => (prev === opt.id ? null : opt.id));
                  }}
                  aria-pressed={isPending}
                  style={{
                    flex: 1,
                    padding: `${spacing.md}px 0`,
                    borderRadius: radius.md,
                    border: `${borderWidth.hairline}px solid ${
                      isPending ? cat.bar : palette.border
                    }`,
                    background: isPending ? cat.surface : palette.surface,
                    color: isPending ? cat.text : palette.textPrimary,
                    fontSize: fontSize.body,
                    fontWeight: fontWeight.medium,
                    cursor: "pointer",
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          {pendingOption ? (
            <div
              style={{
                padding: `${spacing.sm}px ${spacing.md}px`,
                borderRadius: radius.md,
                background: cat.surface,
                display: "flex",
                alignItems: "center",
                gap: spacing.sm,
              }}
            >
              <span
                style={{
                  flex: 1,
                  fontSize: fontSize.label,
                  fontWeight: fontWeight.medium,
                  color: cat.text,
                  lineHeight: lineHeight.tight,
                }}
              >
                ‘{pendingOption.label}’(으)로 투표할까요?
              </span>
              <div onClick={stop}>
                <Button
                  size="small"
                  variant="weak"
                  color="dark"
                  onClick={() => setPendingId(null)}
                >
                  취소
                </Button>
              </div>
              <div onClick={stop}>
                <Button
                  size="small"
                  variant="fill"
                  color="primary"
                  onClick={() => {
                    setVoted(true);
                    setPendingId(null);
                  }}
                >
                  확정
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function Pill({
  bg,
  fg,
  children,
}: {
  bg: string;
  fg: string;
  children: React.ReactNode;
}) {
  return (
    <span
      style={{
        fontSize: fontSize.caption,
        fontWeight: fontWeight.medium,
        padding: `${spacing.xs}px ${spacing.sm}px`,
        borderRadius: radius.sm,
        background: bg,
        color: fg,
      }}
    >
      {children}
    </span>
  );
}

function ResultBar({
  option,
  barColor,
}: {
  option: VoteOption;
  barColor: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: spacing.sm }}>
      <span
        style={{
          fontSize: fontSize.small,
          color: palette.textSecondary,
          width: 56,
          flexShrink: 0,
        }}
      >
        {option.label}
      </span>
      <div
        style={{
          flex: 1,
          height: controlHeight.bar,
          borderRadius: radius.sm,
          background: palette.divider,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${option.ratio}%`,
            height: "100%",
            background: barColor,
            borderRadius: radius.sm,
          }}
        />
      </div>
      <span
        style={{
          fontSize: fontSize.small,
          fontWeight: fontWeight.medium,
          width: 36,
          textAlign: "right",
          color: barColor,
        }}
      >
        {option.ratio}%
      </span>
    </div>
  );
}
