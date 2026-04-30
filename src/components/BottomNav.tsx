import { Link, useLocation } from "react-router-dom";
import {
  borderWidth,
  fontSize,
  fontWeight,
  palette,
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

export function BottomNav() {
  const { pathname } = useLocation();

  return (
    <nav
      style={{
        display: "flex",
        background: palette.background,
        borderTop: `${borderWidth.hairline}px solid ${palette.border}`,
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {NAV_ITEMS.map((it) => {
        const isActive = it.match(pathname);
        return (
          <Link
            key={it.to}
            to={it.to}
            aria-current={isActive ? "page" : undefined}
            style={{
              flex: 1,
              padding: `${spacing.md}px 0`,
              textAlign: "center",
              color: isActive ? palette.brandText : palette.textSecondary,
              fontSize: fontSize.label,
              fontWeight: isActive ? fontWeight.bold : fontWeight.medium,
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
