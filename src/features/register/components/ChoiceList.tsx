import { TextField } from "@toss/tds-mobile";
import {
  borderWidth,
  fontSize,
  fontWeight,
  palette,
  radius,
  spacing,
  touchTarget,
} from "../../../design/tokens";
import {
  CHOICE_MAX_LENGTH,
  MAX_CHOICES,
  MIN_CHOICES,
  type Choice,
} from "../types";
import { FormSection } from "./FormSection";

type Props = {
  choices: Choice[];
  errorMessage?: string;
  onChange: (id: string, next: string) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onBlur: () => void;
};

export function ChoiceList({
  choices,
  errorMessage,
  onChange,
  onAdd,
  onRemove,
  onBlur,
}: Props) {
  const canAdd = choices.length < MAX_CHOICES;
  const removable = choices.length > MIN_CHOICES;

  return (
    <FormSection
      title="선택지"
      subtitle={`${MIN_CHOICES}~${MAX_CHOICES}개`}
      errorMessage={errorMessage}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: spacing.sm }}>
        {choices.map((choice, idx) => (
          <div
            key={choice.id}
            style={{ display: "flex", alignItems: "center", gap: spacing.sm }}
          >
            <div style={{ flex: 1 }}>
              <TextField
                variant="box"
                placeholder={`선택지 ${idx + 1}`}
                value={choice.value}
                onChange={(e) => onChange(choice.id, e.target.value)}
                onBlur={onBlur}
                maxLength={CHOICE_MAX_LENGTH}
              />
            </div>
            {removable ? (
              <button
                type="button"
                onClick={() => onRemove(choice.id)}
                aria-label={`선택지 ${idx + 1} 삭제`}
                style={removeButtonStyle}
              >
                ×
              </button>
            ) : null}
          </div>
        ))}
      </div>

      {canAdd ? (
        <button type="button" onClick={onAdd} style={addButtonStyle}>
          + 선택지 추가
        </button>
      ) : null}
    </FormSection>
  );
}

const removeButtonStyle: React.CSSProperties = {
  width: touchTarget.md,
  height: touchTarget.md,
  borderRadius: radius.pill,
  border: `${borderWidth.hairline}px solid ${palette.border}`,
  background: palette.background,
  color: palette.textSecondary,
  fontSize: fontSize.iconLarge,
  lineHeight: 1,
  cursor: "pointer",
  flexShrink: 0,
};

const addButtonStyle: React.CSSProperties = {
  marginTop: spacing.md,
  width: "100%",
  padding: `${spacing.md}px ${spacing.lg}px`,
  borderRadius: radius.md,
  border: `${borderWidth.hairline}px dashed ${palette.border}`,
  background: palette.background,
  color: palette.textSecondary,
  fontSize: fontSize.body,
  fontWeight: fontWeight.regular,
  cursor: "pointer",
};
