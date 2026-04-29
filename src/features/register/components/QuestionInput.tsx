import { TextField } from "@toss/tds-mobile";
import { fontSize, palette, spacing } from "../../../design/tokens";
import { QUESTION_MAX_LENGTH } from "../types";

type Props = {
  value: string;
  errorMessage?: string;
  onChange: (next: string) => void;
  onBlur: () => void;
};

export function QuestionInput({ value, errorMessage, onChange, onBlur }: Props) {
  const remaining = QUESTION_MAX_LENGTH - value.length;
  const hasError = Boolean(errorMessage);

  return (
    <div style={{ padding: `${spacing.lg}px ${spacing.lg}px 0` }}>
      <TextField
        variant="box"
        label="질문"
        labelOption="sustain"
        placeholder="예) 첫 만남 더치페이 괜찮아?"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        maxLength={QUESTION_MAX_LENGTH}
        hasError={hasError}
        help={
          hasError ? (
            errorMessage
          ) : (
            <span
              style={{
                fontSize: fontSize.small,
                color: remaining <= 5 ? palette.brand : palette.textTertiary,
              }}
            >
              {value.length} / {QUESTION_MAX_LENGTH}자
            </span>
          )
        }
      />
    </div>
  );
}
