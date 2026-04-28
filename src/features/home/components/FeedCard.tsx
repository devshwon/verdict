import { useState } from "react";
import {
  categories,
  categoryColors,
  feedTagStyles,
  palette,
  radius,
  spacing,
} from "../../../design/tokens";
import type { FeedVote, VoteOption } from "../types";

type Props = {
  vote: FeedVote;
};

export function FeedCard({ vote }: Props) {
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
      style={{
        margin: `${spacing.sm}px ${spacing.lg}px`,
        padding: spacing.lg,
        borderRadius: radius.lg,
        border: `1px solid ${palette.border}`,
        background: palette.background,
        display: "flex",
        flexDirection: "column",
        gap: spacing.sm,
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
            fontSize: 12,
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
          fontSize: 15,
          fontWeight: 600,
          color: palette.textPrimary,
          lineHeight: 1.45,
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
                fontSize: 12,
                fontWeight: 600,
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
              barColor={
                opt.ratio >= 50 ? cat.bar : palette.textTertiary
              }
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
                  onClick={() =>
                    setPendingId((prev) => (prev === opt.id ? null : opt.id))
                  }
                  aria-pressed={isPending}
                  style={{
                    flex: 1,
                    padding: `${spacing.sm + 2}px 0`,
                    borderRadius: radius.md,
                    border: `1px solid ${
                      isPending ? cat.bar : palette.border
                    }`,
                    background: isPending ? cat.surface : palette.surface,
                    color: isPending ? cat.text : palette.textPrimary,
                    fontSize: 14,
                    fontWeight: 600,
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
                  fontSize: 13,
                  fontWeight: 600,
                  color: cat.text,
                  lineHeight: 1.4,
                }}
              >
                ‘{pendingOption.label}’(으)로 투표할까요?
              </span>
              <button
                type="button"
                onClick={() => setPendingId(null)}
                style={{
                  padding: `${spacing.xs}px ${spacing.md}px`,
                  borderRadius: radius.sm,
                  border: `1px solid ${palette.border}`,
                  background: palette.background,
                  color: palette.textSecondary,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => {
                  setVoted(true);
                  setPendingId(null);
                }}
                style={{
                  padding: `${spacing.xs}px ${spacing.md}px`,
                  borderRadius: radius.sm,
                  border: "none",
                  background: cat.bar,
                  color: palette.background,
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                확정
              </button>
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
        fontSize: 11,
        fontWeight: 600,
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
          fontSize: 12,
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
          height: 8,
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
          fontSize: 12,
          fontWeight: 600,
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
