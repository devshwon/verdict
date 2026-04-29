import {
  borderWidth,
  fontSize,
  fontWeight,
  palette,
  radius,
  spacing,
} from "../../../design/tokens";
import type { DemographicBucket, VoteDetailOption } from "../types";
import { ResultBar } from "./ResultBar";

type Props = {
  title: string;
  buckets: DemographicBucket[];
  options: VoteDetailOption[];
  myOptionId: string | null;
  accentBar: string;
};

export function DemographicGroup({
  title,
  buckets,
  options,
  myOptionId,
  accentBar,
}: Props) {
  return (
    <section
      style={{
        margin: `${spacing.md}px ${spacing.lg}px`,
        padding: spacing.lg,
        borderRadius: radius.lg,
        background: palette.background,
        border: `${borderWidth.hairline}px solid ${palette.border}`,
        display: "flex",
        flexDirection: "column",
        gap: spacing.md,
      }}
    >
      <h3
        style={{
          margin: 0,
          fontSize: fontSize.subtitle,
          fontWeight: fontWeight.bold,
          color: palette.textPrimary,
        }}
      >
        {title}
      </h3>

      <div
        style={{ display: "flex", flexDirection: "column", gap: spacing.md }}
      >
        {buckets.map((bucket) => (
          <div
            key={bucket.key}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: spacing.xs,
            }}
          >
            <span
              style={{
                fontSize: fontSize.label,
                fontWeight: fontWeight.medium,
                color: palette.textSecondary,
              }}
            >
              {bucket.label}
            </span>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: spacing.xs,
              }}
            >
              {options.map((opt) => {
                const ratio = bucket.optionRatios[opt.id] ?? 0;
                const isMine = myOptionId === opt.id;
                return (
                  <ResultBar
                    key={opt.id}
                    label={opt.label}
                    ratio={ratio}
                    barColor={isMine ? accentBar : palette.textTertiary}
                    highlighted={isMine}
                    labelWidth={64}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
