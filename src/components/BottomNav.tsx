import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  borderWidth,
  fontSize,
  fontWeight,
  palette,
  shadow,
  spacing,
  touchTarget,
} from "../design/tokens";

const NAV_ITEMS: {
  to: string;
  label: string;
  icon: string;
  match: (p: string) => boolean;
}[] = [
  { to: "/", label: "홈", icon: "🏠", match: (p) => p === "/" },
  {
    to: "/register",
    label: "등록",
    icon: "✏️",
    match: (p) => p.startsWith("/register"),
  },
  {
    to: "/mypage",
    label: "마이",
    icon: "👤",
    match: (p) => p.startsWith("/mypage"),
  },
];

const NAV_HEIGHT = 56;
const NAV_RADIUS = 24;
const ICON_SIZE = 18;

/**
 * 모바일 가상 키보드가 올라온 상태인지 감지.
 * visualViewport.height가 layout viewport(window.innerHeight)보다 작으면 키보드 노출 중.
 */
function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const KEYBOARD_THRESHOLD = 150; // 키보드 최소 높이로 가정 (URL바 변동은 무시)
    const update = () => {
      const delta = window.innerHeight - vv.height;
      setOpen(delta > KEYBOARD_THRESHOLD);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return open;
}

export function BottomNav() {
  const { pathname } = useLocation();
  const keyboardOpen = useKeyboardOpen();

  if (keyboardOpen) return null;

  return (
    <nav
      aria-label="하단 메뉴"
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        margin: 0,
        // wrapper 자체는 클릭 통과(콘텐츠 보호) — inner 만 pointer-events 활성화
        padding: `${spacing.md}px ${spacing.lg}px calc(${spacing.md}px + env(safe-area-inset-bottom))`,
        boxSizing: "border-box",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-end",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          pointerEvents: "auto",
          width: "100%",
          maxWidth: 360,
          minHeight: NAV_HEIGHT,
          display: "flex",
          alignItems: "stretch",
          boxSizing: "border-box",
          background: palette.background,
          border: `${borderWidth.hairline}px solid ${palette.border}`,
          borderRadius: NAV_RADIUS,
          boxShadow: shadow.md,
        }}
      >
        {NAV_ITEMS.map(({ to, label, icon, match }) => {
          const isActive = match(pathname);
          return (
            <Link
              key={to}
              to={to}
              aria-current={isActive ? "page" : undefined}
              style={{
                position: "relative",
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: spacing.xs,
                minWidth: 0,
                minHeight: touchTarget.md,
                padding: `${spacing.xs}px ${spacing.xs}px`,
                boxSizing: "border-box",
                fontSize: fontSize.small,
                fontWeight: isActive ? fontWeight.bold : fontWeight.medium,
                color: isActive ? palette.brandText : palette.textSecondary,
                textDecoration: "none",
                transition: "color 0.2s",
              }}
            >
              <span aria-hidden style={{ fontSize: ICON_SIZE, lineHeight: 1 }}>
                {icon}
              </span>
              <span style={{ whiteSpace: "nowrap" }}>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
