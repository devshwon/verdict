import {
  borderWidth,
  fontSize,
  fontWeight,
  palette,
  radius,
  spacing,
} from "../../../design/tokens";
import { durations, type DurationKey } from "../types";
import { FormSection } from "./FormSection";

type Props = {
  value: DurationKey;
  onChange: (next: DurationKey) => void;
};

export function DurationPicker({ value, onChange }: Props) {
  return (
    <FormSection title="투표 기간">
      <div
        role="radiogroup"
        aria-label="투표 기간 선택"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: spacing.sm,
        }}
      >
        {durations.map((d) => {
          const active = d.key === value;
          return (
            <button
              key={d.key}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(d.key)}
              style={{
                padding: `${spacing.sm}px ${spacing.lg}px`,
                borderRadius: radius.pill,
                border: `${borderWidth.hairline}px solid ${
                  active ? palette.brand : palette.border
                }`,
                background: active ? palette.brandSurface : palette.background,
                color: active ? palette.brandText : palette.textSecondary,
                fontSize: fontSize.body,
                fontWeight: active ? fontWeight.medium : fontWeight.regular,
                cursor: "pointer",
              }}
            >
              {d.label}
            </button>
          );
        })}
      </div>
    </FormSection>
  );
}
