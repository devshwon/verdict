import { Link, useLocation } from "react-router-dom";
import {
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
  { to: "/mypage", label: "마이", match: (p) => p.startsWith("/mypage") },
];

const VISIBLE_PATHS = new Set(NAV_ITEMS.map((it) => it.to));

export function BottomNav() {
  const { pathname } = useLocation();
  const isVisible =
    VISIBLE_PATHS.has(pathname) || pathname.startsWith("/mypage");
  if (!isVisible) return null;

  return (
    <nav
      style={{
        position: "fixed",
        bottom: spacing.lg,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        gap: spacing.xs,
        padding: spacing.xs,
        background: palette.background,
        borderRadius: radius.pill,
        border: `1px solid ${palette.border}`,
        boxShadow: shadow.md,
        zIndex: 10,
      }}
    >
      {NAV_ITEMS.map((it) => {
        const isActive = it.match(pathname);
        return (
          <Link
            key={it.to}
            to={it.to}
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
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
