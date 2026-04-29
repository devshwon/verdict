import type { ReactNode } from "react";
import { fontSize, fontWeight, radius, spacing } from "../design/tokens";

type Props = {
  bg: string;
  fg: string;
  children: ReactNode;
};

export function Pill({ bg, fg, children }: Props) {
  return (
    <span
      style={{
        fontSize: fontSize.caption,
        fontWeight: fontWeight.medium,
        padding: `${spacing.xs}px ${spacing.sm}px`,
        borderRadius: radius.sm,
        background: bg,
        color: fg,
      }}
    >
      {children}
    </span>
  );
}
