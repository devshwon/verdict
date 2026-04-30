import { Button } from "@toss/tds-mobile";
import { spacing } from "../../../design/tokens";
import type { VoteDetailOption } from "../types";

type Props = {
  options: VoteDetailOption[];
  disabled?: boolean;
  onPick: (optionId: string) => void;
};

export function VoteOptions({ options, disabled, onPick }: Props) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing.sm }}>
      {options.map((opt) => (
        <Button
          key={opt.id}
          size="large"
          display="full"
          variant="weak"
          color="dark"
          disabled={disabled}
          onClick={() => onPick(opt.id)}
        >
          {opt.label}
        </Button>
      ))}
    </div>
  );
}
