import { palette, radius, spacing } from "../../../design/tokens";

export function AdBanner() {
  return (
    <div
      style={{
        margin: `${spacing.sm}px ${spacing.lg}px`,
        padding: spacing.lg,
        borderRadius: radius.md,
        border: `1px dashed ${palette.border}`,
        background: palette.surface,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: 64,
        color: palette.textSecondary,
        fontSize: 13,
        fontWeight: 500,
      }}
    >
      광고 배너 영역
    </div>
  );
}
