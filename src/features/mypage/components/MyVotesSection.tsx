import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Pill } from "../../../components/Pill";
import { SectionTitle } from "../../../components/SectionTitle";
import {
  borderWidth,
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

type TabKey = "ongoing" | "closed" | "review";

export function MyVotesSection({ votes }: Props) {
  const [tab, setTab] = useState<TabKey>("ongoing");

  const filtered = useMemo(
    () =>
      votes.filter((v) => {
        if (tab === "ongoing") return v.status === "ongoing";
        if (tab === "closed") return v.status === "closed";
        return (
          v.status === "pending_review" ||
          v.status === "blinded" ||
          v.status === "deleted"
        );
      }),
    [votes, tab],
  );

  const reviewCount = useMemo(
    () =>
      votes.filter(
        (v) =>
          v.status === "pending_review" ||
          v.status === "blinded" ||
          v.status === "deleted",
      ).length,
    [votes],
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
      <Segmented active={tab} onChange={setTab} reviewCount={reviewCount} />
      {filtered.length === 0 ? (
        <Empty
          message={
            tab === "ongoing"
              ? "진행 중인 투표가 없어요."
              : tab === "closed"
                ? "마감된 투표가 없어요."
                : "심사 중이거나 반려된 투표가 없어요."
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
  reviewCount,
}: {
  active: TabKey;
  onChange: (s: TabKey) => void;
  reviewCount: number;
}) {
  const items: { key: TabKey; label: string }[] = [
    { key: "ongoing", label: "진행중" },
    { key: "closed", label: "마감" },
    {
      key: "review",
      label: reviewCount > 0 ? `심사·반려 ${reviewCount}` : "심사·반려",
    },
  ];
  return (
    <div
      style={{
        display: "flex",
        padding: spacing.xs,
        background: palette.surface,
        borderRadius: radius.md,
        border: `${borderWidth.hairline}px solid ${palette.border}`,
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

function statusLabel(status: MyVoteStatus): {
  label: string;
  color: string;
  bg: string;
} {
  switch (status) {
    case "pending_review":
      return { label: "심사 중", bg: "#FAEEDA", color: "#633806" };
    case "blinded":
      return { label: "반려", bg: "#FBE9E7", color: "#712B13" };
    case "deleted":
      return { label: "삭제됨", bg: "#FBE9E7", color: "#712B13" };
    case "closed":
      return { label: "마감", bg: palette.divider, color: palette.textTertiary };
    default:
      return { label: "진행중", bg: palette.brandSurface, color: palette.brandText };
  }
}

function Row({ vote }: { vote: MyVote }) {
  const navigate = useNavigate();
  const cat = categoryColors[vote.category];
  const categoryLabel =
    categories.find((c) => c.key === vote.category)?.label ?? "";
  const isOngoing = vote.status === "ongoing";
  const sLabel = statusLabel(vote.status);
  // 심사 중/반려는 상세가 fetchVoteDetail의 status 필터(active|closed)에 걸려 NotFound 처리되므로 진입 차단
  const canOpen = vote.status === "ongoing" || vote.status === "closed";

  return (
    <div
      role={canOpen ? "button" : undefined}
      tabIndex={canOpen ? 0 : undefined}
      onClick={canOpen ? () => navigate(`/vote/${vote.id}`) : undefined}
      onKeyDown={
        canOpen
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                navigate(`/vote/${vote.id}`);
              }
            }
          : undefined
      }
      style={{
        padding: spacing.md,
        borderRadius: radius.md,
        background: palette.background,
        border: `${borderWidth.hairline}px solid ${palette.border}`,
        display: "flex",
        flexDirection: "column",
        gap: spacing.sm,
        cursor: canOpen ? "pointer" : "default",
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
        <Pill bg={sLabel.bg} fg={sLabel.color}>
          {sLabel.label}
        </Pill>
        <span
          style={{
            marginLeft: "auto",
            fontSize: fontSize.small,
            fontWeight: fontWeight.medium,
            color: isOngoing ? cat.bar : palette.textTertiary,
          }}
        >
          {isOngoing ? vote.remainingLabel ?? "" : ""}
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
      {vote.status === "blinded" && vote.rejectionReason ? (
        <div
          style={{
            padding: spacing.sm,
            borderRadius: radius.sm,
            background: "#FBE9E7",
            color: "#712B13",
            fontSize: fontSize.small,
            lineHeight: lineHeight.body,
          }}
        >
          반려 사유: {vote.rejectionReason}
        </div>
      ) : null}
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
        border: `${borderWidth.hairline}px dashed ${palette.border}`,
        textAlign: "center",
        color: palette.textSecondary,
        fontSize: fontSize.label,
      }}
    >
      {message}
    </div>
  );
}
