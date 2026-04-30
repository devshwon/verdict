import { Button } from "@toss/tds-mobile";
import {
  fontSize,
  fontWeight,
  palette,
  spacing,
} from "../../../design/tokens";

type Props = {
  onHome: () => void;
};

export function NotFound({ onHome }: Props) {
  return (
    <div
      style={{
        background: palette.surface,
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: spacing.md,
        padding: spacing.xl,
        textAlign: "center",
      }}
    >
      <span
        style={{
          fontSize: fontSize.title,
          fontWeight: fontWeight.bold,
          color: palette.textPrimary,
        }}
      >
        투표를 찾을 수 없어요
      </span>
      <span style={{ fontSize: fontSize.label, color: palette.textSecondary }}>
        잘못된 링크이거나 삭제된 투표일 수 있어요
      </span>
      <div style={{ marginTop: spacing.sm }}>
        <Button size="medium" variant="fill" color="primary" onClick={onHome}>
          홈으로
        </Button>
      </div>
    </div>
  );
}
