import { iconSize, iconStroke, palette } from "../design/tokens";

export type IconProps = { active: boolean };

const SIZE = iconSize.nav;
const STROKE = iconStroke.regular;

function colors(active: boolean) {
  return {
    stroke: active ? palette.brandText : palette.textSecondary,
    fill: active ? palette.brandSurface : "none",
  };
}

export function HomeIcon({ active }: IconProps) {
  const { stroke, fill } = colors(active);
  return (
    <svg width={SIZE} height={SIZE} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3.5 10.5 12 4l8.5 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-4V14h-6v6.5H5A1.5 1.5 0 0 1 3.5 19v-8.5Z"
        stroke={stroke}
        strokeWidth={STROKE}
        strokeLinejoin="round"
        fill={fill}
      />
    </svg>
  );
}

export function PlusIcon({ active }: IconProps) {
  const { stroke, fill } = colors(active);
  return (
    <svg width={SIZE} height={SIZE} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle
        cx={12}
        cy={12}
        r={9}
        stroke={stroke}
        strokeWidth={STROKE}
        fill={fill}
      />
      <path
        d="M12 8v8M8 12h8"
        stroke={stroke}
        strokeWidth={STROKE}
        strokeLinecap="round"
      />
    </svg>
  );
}

export function UserIcon({ active }: IconProps) {
  const { stroke, fill } = colors(active);
  return (
    <svg width={SIZE} height={SIZE} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle
        cx={12}
        cy={8.5}
        r={3.8}
        stroke={stroke}
        strokeWidth={STROKE}
        fill={fill}
      />
      <path
        d="M4.5 20c1.6-3.4 4.4-5.2 7.5-5.2s5.9 1.8 7.5 5.2"
        stroke={stroke}
        strokeWidth={STROKE}
        strokeLinecap="round"
        fill={fill}
      />
    </svg>
  );
}
