import {
  controlHeight,
  fontSize,
  palette,
  radius,
  spacing,
} from "../../../design/tokens";

type Props = {
  onBack: () => void;
};

export function DetailHeader({ onBack }: Props) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        height: controlHeight.header,
        padding: `0 ${spacing.sm}px`,
      }}
    >
      <button
        type="button"
        onClick={onBack}
        aria-label="뒤로가기"
        style={{
          width: controlHeight.iconButton,
          height: controlHeight.iconButton,
          borderRadius: radius.pill,
          border: "none",
          background: "transparent",
          color: palette.textPrimary,
          fontSize: fontSize.hero,
          cursor: "pointer",
        }}
      >
        ←
      </button>
    </header>
  );
}
