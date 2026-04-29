import {
  fontSize,
  fontWeight,
  palette,
  radius,
  spacing,
} from "../../../design/tokens";
import type { MyStats } from "../types";

type Props = {
  stats: MyStats;
};

export function StatGrid({ stats }: Props) {
  return (
    <div
      style={{
        margin: `0 ${spacing.lg}px ${spacing.lg}px`,
        padding: spacing.md,
        borderRadius: radius.lg,
        background: palette.background,
        border: `1px solid ${palette.border}`,
        display: "flex",
      }}
    >
      <StatCell label="올린 투표" value={stats.created} />
      <Divider />
      <StatCell label="참여한 투표" value={stats.participated} />
      <Divider />
      <StatCell label="상단 선정" value={stats.featured} />
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: number }) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: spacing.xs,
        padding: `${spacing.sm}px 0`,
      }}
    >
      <span
        style={{
          fontSize: fontSize.heading,
          fontWeight: fontWeight.bold,
          color: palette.textPrimary,
        }}
      >
        {value.toLocaleString()}
      </span>
      <span
        style={{
          fontSize: fontSize.small,
          color: palette.textSecondary,
          fontWeight: fontWeight.regular,
        }}
      >
        {label}
      </span>
    </div>
  );
}

function Divider() {
  return (
    <div
      style={{
        width: 1,
        background: palette.divider,
        margin: `${spacing.xs}px 0`,
      }}
    />
  );
}
