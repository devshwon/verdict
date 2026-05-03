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
        // safe-area-inset 만큼 아래 여백 추가 (키보드 노출 시 BottomNav가 사라져도 home indicator 회피)
        paddingBottom: `calc(${spacing.lg}px + env(safe-area-inset-bottom))`,
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
