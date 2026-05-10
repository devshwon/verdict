/**
 * 토스 인앱 WebView 의 정확한 Safe Area 값을 CSS 변수로 주입.
 *
 * 배경:
 *   토스 인앱 WebView 에서 `env(safe-area-inset-*)` 가 0 또는 부정확한 값을
 *   반환하는 경우가 있음 (특히 Android — home indicator/시스템 navigation bar
 *   영역이 누락되어 BottomNav 가 화면 안쪽으로 떠 보임).
 *
 *   토스 docs (Apps-in-Toss) 권장 패턴: `SafeAreaInsets.get()` 으로 SDK 가
 *   계산한 정확한 px 값을 받아 CSS 변수로 주입하고, 컴포넌트는 그 변수를 사용.
 *
 * 사용:
 *   AppShell 에서 한 번 호출 → document root 에 다음 변수 주입:
 *     - `--safe-area-inset-bottom-px`
 *     - `--safe-area-inset-top-px`
 *   각 컴포넌트는 `var(--safe-area-inset-bottom-px, 0px)` 로 참조.
 *   비-WebView 환경 (개발 브라우저 등) 에선 0 fallback.
 */
import { useEffect } from "react";
import { SafeAreaInsets } from "@apps-in-toss/web-framework";

const VAR_BOTTOM = "--safe-area-inset-bottom-px";
const VAR_TOP = "--safe-area-inset-top-px";

function setSafeAreaVars(top: number, bottom: number): void {
  const root = document.documentElement;
  root.style.setProperty(VAR_BOTTOM, `${bottom}px`);
  root.style.setProperty(VAR_TOP, `${top}px`);
}

export function useSafeAreaVars(): void {
  useEffect(() => {
    let top = 0;
    let bottom = 0;
    try {
      const insets = SafeAreaInsets.get();
      top = insets.top ?? 0;
      bottom = insets.bottom ?? 0;
      setSafeAreaVars(top, bottom);
    } catch {
      setSafeAreaVars(0, 0);
    }

    let cleanup: (() => void) | undefined;
    try {
      cleanup = SafeAreaInsets.subscribe({
        onEvent: (insets) => {
          const t = insets.top ?? 0;
          const b = insets.bottom ?? 0;
          setSafeAreaVars(t, b);
        },
      });
    } catch {
      // 비-WebView 환경 등 subscribe 실패 시 무시
    }

    return () => {
      cleanup?.();
      document.documentElement.style.removeProperty(VAR_BOTTOM);
      document.documentElement.style.removeProperty(VAR_TOP);
    };
  }, []);
}
