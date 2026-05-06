import { Button } from "@toss/tds-mobile";
import { borderWidth, palette, spacing } from "../../../design/tokens";

type Props = {
  disabled: boolean;
  loading: boolean;
  onSubmit: () => void;
  label?: string;
};

export function SubmitBar({ disabled, loading, onSubmit, label = "등록하기" }: Props) {
  return (
    <div
      style={{
        padding: spacing.lg,
        // BottomNav가 떠 있을 땐 BottomNav가 safe-area-inset-bottom을 처리하므로
        // 여기서 더하면 안드로이드 WebView에서 등록 버튼 ↔ 네비 간 여백이 두 배로 누적됨.
        // 키보드 노출 시엔 키보드 자체가 home indicator를 가리므로 보정 불필요.
        background: palette.background,
        borderTop: `${borderWidth.hairline}px solid ${palette.divider}`,
      }}
    >
      <Button
        display="block"
        size="xlarge"
        color="primary"
        variant="fill"
        disabled={disabled}
        loading={loading}
        onClick={onSubmit}
      >
        {label}
      </Button>
    </div>
  );
}
