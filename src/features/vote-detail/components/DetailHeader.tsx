import {
  controlHeight,
  fontSize,
  palette,
  radius,
  spacing,
} from "../../../design/tokens";

type Props = {
  onBack: () => void;
  onReport?: () => void;
};

export function DetailHeader({ onBack, onReport }: Props) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
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
      {onReport ? (
        <button
          type="button"
          onClick={onReport}
          aria-label="신고하기"
          style={{
            height: controlHeight.iconButton,
            padding: `0 ${spacing.sm}px`,
            borderRadius: radius.pill,
            border: "none",
            background: "transparent",
            color: palette.textSecondary,
            fontSize: fontSize.label,
            cursor: "pointer",
          }}
        >
          신고
        </button>
      ) : null}
    </header>
  );
}
