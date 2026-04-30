import type { ReactNode } from "react";
import { palette } from "../design/tokens";
import { BottomNav } from "./BottomNav";

type Props = {
  children: ReactNode;
  footer?: ReactNode;
  hideBottomNav?: boolean;
};

export function AppShell({ children, footer, hideBottomNav = false }: Props) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100dvh",
        background: palette.surface,
        overflow: "hidden",
      }}
    >
      <main
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {children}
      </main>
      {footer ? <div style={{ flexShrink: 0 }}>{footer}</div> : null}
      {!hideBottomNav ? <BottomNav /> : null}
    </div>
  );
}
