import {
  borderWidth,
  categoryColors,
  fontSize,
  fontWeight,
  palette,
  radius,
  registerCategories,
  spacing,
} from "../../../design/tokens";
import type { RegisterCategory } from "../types";
import { FormSection } from "./FormSection";

type Props = {
  value: RegisterCategory | null;
  errorMessage?: string;
  onChange: (next: RegisterCategory) => void;
};

export function CategoryPicker({ value, errorMessage, onChange }: Props) {
  return (
    <FormSection title="카테고리" errorMessage={errorMessage}>
      <div
        role="radiogroup"
        aria-label="카테고리 선택"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: spacing.sm,
        }}
      >
        {registerCategories.map((c) => {
          const active = c.key === value;
          const color = categoryColors[c.key];
          return (
            <button
              key={c.key}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(c.key)}
              style={{
                padding: `${spacing.sm}px ${spacing.lg}px`,
                borderRadius: radius.pill,
                border: `${borderWidth.hairline}px solid ${
                  active ? color.bar : palette.border
                }`,
                background: active ? color.surface : palette.background,
                color: active ? color.text : palette.textSecondary,
                fontSize: fontSize.body,
                fontWeight: active ? fontWeight.medium : fontWeight.regular,
                cursor: "pointer",
              }}
            >
              {c.label}
            </button>
          );
        })}
      </div>
    </FormSection>
  );
}
