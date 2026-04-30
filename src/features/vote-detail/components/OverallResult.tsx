import {
  borderWidth,
  fontSize,
  fontWeight,
  layout,
  palette,
  radius,
  spacing,
} from "../../../design/tokens";
import { ResultBar } from "./ResultBar";

type Props = {
  options: { id: string; label: string; ratio: number }[];
  myOptionId: string | null;
  accentBar: string;
  isClosed: boolean;
};

export function OverallResult({
  options,
  myOptionId,
  accentBar,
  isClosed,
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
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
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
          전체 결과
        </h3>
        {isClosed && !myOptionId ? (
          <span
            style={{ fontSize: fontSize.small, color: palette.textSecondary }}
          >
            마감된 투표예요
          </span>
        ) : null}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: spacing.sm }}>
        {options.map((opt) => (
          <ResultBar
            key={opt.id}
            label={opt.label}
            ratio={opt.ratio}
            barColor={myOptionId === opt.id ? accentBar : palette.textTertiary}
            highlighted={myOptionId === opt.id}
            labelWidth={layout.resultLabelMd}
          />
        ))}
      </div>
    </section>
  );
}
