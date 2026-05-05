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
  matchStyles,
  palette,
  radius,
  spacing,
} from "../../../design/tokens";
import type { ParticipatedVote } from "../types";

type Props = {
  votes: ParticipatedVote[];
};

export function ParticipatedSection({ votes }: Props) {
  return (
    <section
      style={{
        margin: `0 ${spacing.lg}px ${spacing.xxl}px`,
        display: "flex",
        flexDirection: "column",
        gap: spacing.md,
      }}
    >
      <SectionTitle>참여한 투표</SectionTitle>
      {votes.length === 0 ? (
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
          아직 참여한 투표가 없어요.
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: spacing.sm,
          }}
        >
          {votes.map((v) => (
            <Row key={v.id} vote={v} />
          ))}
        </div>
      )}
    </section>
  );
}

function Row({ vote }: { vote: ParticipatedVote }) {
  const navigate = useNavigate();
  const cat = categoryColors[vote.category];
  const categoryLabel =
    categories.find((c) => c.key === vote.category)?.label ?? "";
  const matchStyle = vote.matched
    ? matchStyles.matched
    : matchStyles.mismatched;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/vote/${vote.id}`)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          navigate(`/vote/${vote.id}`);
        }
      }}
      style={{
        padding: spacing.md,
        borderRadius: radius.md,
        background: palette.background,
        border: `${borderWidth.hairline}px solid ${palette.border}`,
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
        <Pill bg={matchStyle.surface} fg={matchStyle.text}>
          {vote.matched ? "✓ 다수의견 일치" : "✗ 다수의견 불일치"}
        </Pill>
        <span
          style={{
            marginLeft: "auto",
            fontSize: fontSize.small,
            color: palette.textSecondary,
          }}
        >
          {vote.participants.toLocaleString()}명
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
      <div
        style={{
          display: "flex",
          gap: spacing.md,
          fontSize: fontSize.small,
          color: palette.textSecondary,
        }}
      >
        <ChoiceLine label="내 선택" value={vote.myChoice} highlight />
        <ChoiceLine label="다수의견" value={vote.majorityChoice} />
      </div>
    </div>
  );
}

function ChoiceLine({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <span style={{ display: "inline-flex", gap: spacing.xs }}>
      <span style={{ color: palette.textTertiary }}>{label}</span>
      <span
        style={{
          color: highlight ? palette.textPrimary : palette.textSecondary,
          fontWeight: highlight ? fontWeight.medium : fontWeight.regular,
        }}
      >
        {value}
      </span>
    </span>
  );
}
