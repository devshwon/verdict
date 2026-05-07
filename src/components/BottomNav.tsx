import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  borderWidth,
  fontSize,
  fontWeight,
  palette,
  radius,
  shadow,
  spacing,
} from "../design/tokens";

const NAV_ITEMS: {
  to: string;
  label: string;
  match: (p: string) => boolean;
}[] = [
  { to: "/", label: "홈", match: (p) => p === "/" },
  { to: "/register", label: "등록", match: (p) => p.startsWith("/register") },
  { to: "/mypage", label: "마이", match: (p) => p.startsWith("/mypage") },
];

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
      style={{
        position: "fixed",
        // safe-area-inset-bottom 만큼 더 띄워서 home indicator 와 겹치지 않게
        bottom: `calc(${spacing.lg}px + env(safe-area-inset-bottom))`,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        gap: spacing.xs,
        padding: spacing.xs,
        background: palette.background,
        borderRadius: radius.pill,
        border: `${borderWidth.hairline}px solid ${palette.border}`,
        boxShadow: shadow.md,
        zIndex: 10,
      }}
    >
      {NAV_ITEMS.map(({ to, label, match }) => {
        const isActive = match(pathname);
        return (
          <Link
            key={to}
            to={to}
            aria-current={isActive ? "page" : undefined}
            style={{
              padding: `${spacing.sm}px ${spacing.lg}px`,
              borderRadius: radius.pill,
              background: isActive ? palette.brandSurface : "transparent",
              color: isActive ? palette.brandText : palette.textSecondary,
              fontSize: fontSize.label,
              fontWeight: fontWeight.bold,
              textDecoration: "none",
            }}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
