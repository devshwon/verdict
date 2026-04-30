import {
  borderWidth,
  categories,
  categoryColors,
  fontSize,
  fontWeight,
  palette,
  radius,
  spacing,
  type CategoryKey,
} from "../../../design/tokens";

type Props = {
  active: CategoryKey;
  onChange: (next: CategoryKey) => void;
};

export function CategoryTabs({ active, onChange }: Props) {
  return (
    <div
      className="hide-scrollbar"
      style={{
        display: "flex",
        gap: spacing.xs,
        overflowX: "auto",
        padding: `${spacing.sm}px ${spacing.lg}px`,
        background: palette.background,
        WebkitOverflowScrolling: "touch",
      }}
    >
      {categories.map((c) => {
        const isActive = c.key === active;
        const color = categoryColors[c.key];

        return (
          <button
            key={c.key}
            type="button"
            onClick={() => onChange(c.key)}
            aria-pressed={isActive}
            style={{
              flexShrink: 0,
              padding: `${spacing.sm}px ${spacing.md}px`,
              borderRadius: radius.pill,
              border: `${borderWidth.hairline}px solid ${isActive ? color.bar : palette.border}`,
              background: isActive ? color.surface : palette.background,
              color: isActive ? color.text : palette.textSecondary,
              fontSize: fontSize.label,
              fontWeight: isActive ? fontWeight.medium : fontWeight.regular,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {c.label}
          </button>
        );
      })}
    </div>
  );
}
