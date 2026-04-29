import {
  borderWidth,
  controlHeight,
  fontSize,
  fontWeight,
  palette,
  radius,
  spacing,
} from "../../../design/tokens";

export function AdBanner() {
  return (
    <div
      style={{
        margin: `${spacing.sm}px ${spacing.lg}px`,
        padding: spacing.lg,
        borderRadius: radius.md,
        border: `${borderWidth.hairline}px dashed ${palette.border}`,
        background: palette.surface,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: controlHeight.adBanner,
        color: palette.textSecondary,
        fontSize: fontSize.label,
        fontWeight: fontWeight.regular,
      }}
    >
      광고 배너 영역
    </div>
  );
}
