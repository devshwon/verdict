import { Switch } from "@toss/tds-mobile";
import {
  borderWidth,
  fontSize,
  fontWeight,
  lineHeight,
  palette,
  radius,
  spacing,
} from "../../../design/tokens";

type Props = {
  checked: boolean;
  onChange: (next: boolean) => void;
};

export function TodayCandidateToggle({ checked, onChange }: Props) {
  return (
    <div style={{ padding: `${spacing.xl}px ${spacing.lg}px 0` }}>
      <div
        style={{
          padding: spacing.lg,
          borderRadius: radius.lg,
          background: checked ? palette.brandSurface : palette.background,
          border: `${borderWidth.hairline}px solid ${
            checked ? palette.brand : palette.border
          }`,
          display: "flex",
          alignItems: "center",
          gap: spacing.md,
        }}
      >
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: fontSize.subtitle,
              fontWeight: fontWeight.medium,
              color: palette.textPrimary,
              marginBottom: spacing.xs,
            }}
          >
            오늘의 투표 후보 신청
          </div>
          <div
            style={{
              fontSize: fontSize.small,
              color: palette.textSecondary,
              lineHeight: lineHeight.tight,
            }}
          >
            {checked
              ? "선정 시 카테고리 상단 고정 노출 + 포인트 보상이 지급돼요."
              : "심사를 거쳐 선정되면 상단에 고정 노출돼요."}
          </div>
        </div>
        <Switch checked={checked} onChange={(_, next) => onChange(next)} />
      </div>
    </div>
  );
}
