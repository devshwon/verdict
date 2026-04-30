import {
  borderWidth,
  controlHeight,
  fontSize,
  fontWeight,
  palette,
  radius,
  spacing,
} from "../../../design/tokens";

// TODO: AIT 비즈월렛 광고 SDK로 교체
export function AdSlot() {
  return (
    <div
      style={{
        margin: `${spacing.md}px ${spacing.lg}px`,
        padding: `${spacing.lg}px`,
        borderRadius: radius.md,
        background: palette.divider,
        border: `${borderWidth.hairline}px dashed ${palette.border}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: controlHeight.ad,
        color: palette.textSecondary,
        fontSize: fontSize.label,
        fontWeight: fontWeight.medium,
      }}
    >
      광고 영역
    </div>
  );
}
