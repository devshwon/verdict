import type { ReactNode, Ref } from "react";
import { palette } from "../design/tokens";
import { useSafeAreaVars } from "../hooks/useSafeAreaVars";
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
  // 토스 인앱 SDK 의 정확한 safe-area 값 → --safe-area-inset-bottom-px CSS 변수
  // (env(safe-area-inset-bottom) 이 Android 에서 부정확한 이슈 회피)
  useSafeAreaVars();

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
          // BottomNav 가 부유 캡슐(position:fixed)이라 콘텐츠 위로 떠 있음.
          // 캡슐 높이 + bottom 여백 + safe-area 만큼 자동 padding 으로
          // 모든 페이지에서 마지막 콘텐츠가 캡슐에 가려지지 않도록 보장.
          paddingBottom: hideBottomNav
            ? 0
            : "calc(80px + var(--safe-area-inset-bottom-px, 0px))",
        }}
      >
        {children}
      </main>
      {footer ? <div style={{ flexShrink: 0 }}>{footer}</div> : null}
      {!hideBottomNav ? <BottomNav /> : null}
    </div>
  );
}
