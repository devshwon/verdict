import type { ReactNode } from "react";
import { fontSize, fontWeight, palette } from "../design/tokens";

type Props = {
  children: ReactNode;
};

export function SectionTitle({ children }: Props) {
  return (
    <h2
      style={{
        margin: 0,
        fontSize: fontSize.title,
        fontWeight: fontWeight.bold,
        color: palette.textPrimary,
      }}
    >
      {children}
    </h2>
  );
}
