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
        // RegisterScreen 의 스크롤 콘텐츠 마지막 요소.
        // BottomNav 캡슐과의 간격은 AppShell main 의 paddingBottom 이 처리.
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
