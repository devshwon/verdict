import {
  borderWidth,
  controlHeight,
  fontSize,
  motion,
  palette,
  radius,
  spacing,
} from "../../../design/tokens";

type Props = {
  accentBar: string;
};

export function ResultSkeleton({ accentBar }: Props) {
  return (
    <div
      style={{
        margin: `${spacing.xl}px ${spacing.lg}px`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: spacing.sm,
        color: palette.textSecondary,
        fontSize: fontSize.label,
      }}
    >
      <div
        aria-hidden
        style={{
          width: controlHeight.spinner,
          height: controlHeight.spinner,
          borderRadius: radius.pill,
          border: `${borderWidth.spinner}px solid ${palette.divider}`,
          borderTopColor: accentBar,
          animation: `vd-spin ${motion.spinMs}ms linear infinite`,
        }}
      />
      결과 집계 중…
    </div>
  );
}
