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

export function BottomNav() {
  const { pathname } = useLocation();

  return (
    <nav
      style={{
        display: "flex",
        background: palette.background,
        borderTop: `${borderWidth.hairline}px solid ${palette.border}`,
        paddingBottom: `max(${spacing.sm}px, min(env(safe-area-inset-bottom), ${spacing.md}px))`,
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
