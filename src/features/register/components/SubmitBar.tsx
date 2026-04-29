import { Button } from "@toss/tds-mobile";
import { borderWidth, layout, palette, spacing } from "../../../design/tokens";

type Props = {
  disabled: boolean;
  loading: boolean;
  onSubmit: () => void;
};

export function SubmitBar({ disabled, loading, onSubmit }: Props) {
  return (
    <div
      style={{
        position: "sticky",
        bottom: layout.bottomNavReserve,
        padding: spacing.lg,
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
        등록하기
      </Button>
    </div>
  );
}
