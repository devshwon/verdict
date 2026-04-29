import {
  controlHeight,
  fontSize,
  fontWeight,
  motion,
  palette,
  radius,
  spacing,
} from "../../../design/tokens";

type Props = {
  label: string;
  ratio: number;
  barColor: string;
  highlighted?: boolean;
  labelWidth?: number;
};

export function ResultBar({
  label,
  ratio,
  barColor,
  highlighted = false,
  labelWidth = 56,
}: Props) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: spacing.sm }}>
      <span
        style={{
          fontSize: fontSize.small,
          color: highlighted ? palette.textPrimary : palette.textSecondary,
          fontWeight: highlighted ? fontWeight.bold : fontWeight.regular,
          width: labelWidth,
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <div
        style={{
          flex: 1,
          height: controlHeight.bar,
          borderRadius: radius.sm,
          background: palette.divider,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${ratio}%`,
            height: "100%",
            background: barColor,
            borderRadius: radius.sm,
            transition: motion.barTransition,
          }}
        />
      </div>
      <span
        style={{
          fontSize: fontSize.small,
          fontWeight: fontWeight.medium,
          width: 36,
          textAlign: "right",
          color: barColor,
        }}
      >
        {ratio}%
      </span>
    </div>
  );
}
