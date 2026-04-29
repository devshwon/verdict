import { useMemo, useState } from "react";
import { Pill } from "../../../components/Pill";
import { SectionTitle } from "../../../components/SectionTitle";
import {
  categories,
  categoryColors,
  fontSize,
  fontWeight,
  lineHeight,
  palette,
  radius,
  shadow,
  spacing,
} from "../../../design/tokens";
import type { MyVote, MyVoteStatus } from "../types";

type Props = {
  votes: MyVote[];
};

export function MyVotesSection({ votes }: Props) {
  const [tab, setTab] = useState<MyVoteStatus>("ongoing");

  const filtered = useMemo(
    () => votes.filter((v) => v.status === tab),
    [votes, tab],
  );

  return (
    <section
      style={{
        margin: `0 ${spacing.lg}px ${spacing.xl}px`,
        display: "flex",
        flexDirection: "column",
        gap: spacing.md,
      }}
    >
      <SectionTitle>내가 올린 투표</SectionTitle>
      <Segmented active={tab} onChange={setTab} />
      {filtered.length === 0 ? (
        <Empty
          message={
            tab === "ongoing"
              ? "진행 중인 투표가 없어요."
              : "마감된 투표가 없어요."
          }
        />
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: spacing.sm,
          }}
        >
          {filtered.map((v) => (
            <Row key={v.id} vote={v} />
          ))}
        </div>
      )}
    </section>
  );
}

function Segmented({
  active,
  onChange,
}: {
  active: MyVoteStatus;
  onChange: (s: MyVoteStatus) => void;
}) {
  const items: { key: MyVoteStatus; label: string }[] = [
    { key: "ongoing", label: "진행중" },
    { key: "closed", label: "마감" },
  ];
  return (
    <div
      style={{
        display: "flex",
        padding: spacing.xs,
        background: palette.surface,
        borderRadius: radius.md,
        border: `1px solid ${palette.border}`,
      }}
    >
      {items.map((it) => {
        const isActive = active === it.key;
        return (
          <button
            key={it.key}
            type="button"
            onClick={() => onChange(it.key)}
            style={{
              flex: 1,
              padding: `${spacing.sm}px 0`,
              borderRadius: radius.sm,
              border: "none",
              background: isActive ? palette.background : "transparent",
              color: isActive ? palette.textPrimary : palette.textSecondary,
              fontSize: fontSize.label,
              fontWeight: fontWeight.medium,
              cursor: "pointer",
              boxShadow: isActive ? shadow.sm : "none",
            }}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

function Row({ vote }: { vote: MyVote }) {
  const cat = categoryColors[vote.category];
  const categoryLabel =
    categories.find((c) => c.key === vote.category)?.label ?? "";
  const isOngoing = vote.status === "ongoing";

  return (
    <div
      style={{
        padding: spacing.md,
        borderRadius: radius.md,
        background: palette.background,
        border: `1px solid ${palette.border}`,
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
        <span
          style={{
            marginLeft: "auto",
            fontSize: fontSize.small,
            fontWeight: fontWeight.medium,
            color: isOngoing ? cat.bar : palette.textTertiary,
          }}
        >
          {isOngoing ? vote.remainingLabel ?? "" : "마감"}
        </span>
      </div>
      <div
        style={{
          fontSize: fontSize.body,
          fontWeight: fontWeight.medium,
          color: palette.textPrimary,
          lineHeight: lineHeight.body,
        }}
      >
        {vote.question}
      </div>
      <span
        style={{
          fontSize: fontSize.small,
          color: palette.textSecondary,
        }}
      >
        {vote.participants.toLocaleString()}명 참여
      </span>
    </div>
  );
}

function Empty({ message }: { message: string }) {
  return (
    <div
      style={{
        padding: spacing.xl,
        borderRadius: radius.md,
        background: palette.surface,
        border: `1px dashed ${palette.border}`,
        textAlign: "center",
        color: palette.textSecondary,
        fontSize: fontSize.label,
      }}
    >
      {message}
    </div>
  );
}
