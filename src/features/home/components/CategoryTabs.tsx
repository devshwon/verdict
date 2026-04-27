import {
  categories,
  categoryColors,
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
      style={{
        display: "flex",
        gap: spacing.xs,
        overflowX: "auto",
        padding: `${spacing.sm}px ${spacing.lg}px`,
        background: palette.background,
      }}
    >
      {categories.map((c) => {
        const isActive = c.key === active;
        const color =
          c.key === "all"
            ? { surface: palette.brandSurface, text: palette.brandText, bar: palette.brand }
            : categoryColors[c.key];

        return (
          <button
            key={c.key}
            type="button"
            onClick={() => onChange(c.key)}
            style={{
              flexShrink: 0,
              padding: `${spacing.xs + 2}px ${spacing.md}px`,
              borderRadius: radius.pill,
              border: `1px solid ${isActive ? color.bar : palette.border}`,
              background: isActive ? color.surface : palette.background,
              color: isActive ? color.text : palette.textSecondary,
              fontSize: 13,
              fontWeight: isActive ? 600 : 500,
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
