import type { ReactNode, Ref } from "react";
import { palette } from "../design/tokens";
import { BottomNav } from "./BottomNav";

type Props = {
  children: ReactNode;
  footer?: ReactNode;
  hideBottomNav?: boolean;
  /** 메인 스크롤 영역 ref. 스크롤 복원 등에 사용 */
  mainRef?: Ref<HTMLElement>;
};

export function AppShell({
  children,
  footer,
  hideBottomNav = false,
  mainRef,
}: Props) {
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
        ref={mainRef}
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
