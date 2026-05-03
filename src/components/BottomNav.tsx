import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  borderWidth,
  fontSize,
  fontWeight,
  palette,
  spacing,
} from "../design/tokens";
import {
  HomeIcon,
  PlusIcon,
  UserIcon,
  type IconProps,
} from "./BottomNavIcons";

const NAV_ITEMS: {
  to: string;
  label: string;
  match: (p: string) => boolean;
  Icon: (p: IconProps) => JSX.Element;
}[] = [
  { to: "/", label: "홈", match: (p) => p === "/", Icon: HomeIcon },
  {
    to: "/register",
    label: "등록",
    match: (p) => p.startsWith("/register"),
    Icon: PlusIcon,
  },
  {
    to: "/mypage",
    label: "마이",
    match: (p) => p.startsWith("/mypage"),
    Icon: UserIcon,
  },
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
        display: "flex",
        background: palette.background,
        borderTop: `${borderWidth.hairline}px solid ${palette.border}`,
        // safe-area-inset 전체 + 최소 breathing room. 미지원 환경에선 0 + sm.
        paddingBottom: `calc(${spacing.sm}px + env(safe-area-inset-bottom))`,
      }}
    >
      {NAV_ITEMS.map(({ to, label, match, Icon }) => {
        const isActive = match(pathname);
        return (
          <Link
            key={to}
            to={to}
            aria-current={isActive ? "page" : undefined}
            style={{
              flex: 1,
              padding: `${spacing.sm}px 0 ${spacing.md}px`,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: spacing.xs,
              color: isActive ? palette.brandText : palette.textSecondary,
              fontSize: fontSize.caption,
              fontWeight: isActive ? fontWeight.bold : fontWeight.medium,
              textDecoration: "none",
            }}
          >
            <Icon active={isActive} />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
