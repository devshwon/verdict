import {
  borderWidth,
  fontSize,
  fontWeight,
  layout,
  palette,
  radius,
  spacing,
} from "../../../design/tokens";
import type { Profile } from "../types";

type Props = {
  profile: Profile;
};

export function ProfileHeader({ profile }: Props) {
  return (
    <div
      style={{
        margin: `${spacing.sm}px ${spacing.lg}px ${spacing.lg}px`,
        padding: spacing.lg,
        borderRadius: radius.lg,
        background: palette.background,
        border: `${borderWidth.hairline}px solid ${palette.border}`,
        display: "flex",
        alignItems: "center",
        gap: spacing.md,
      }}
    >
      <Avatar nickname={profile.nickname} />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: spacing.xs,
          minWidth: 0,
          flex: 1,
        }}
      >
        <span
          style={{
            fontSize: fontSize.title,
            fontWeight: fontWeight.bold,
            color: palette.textPrimary,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {profile.nickname}
        </span>
        {profile.tossVerified ? <VerifiedBadge /> : null}
      </div>
    </div>
  );
}

function getAvatarInitial(nickname: string): string {
  const match = nickname.match(/#([A-Za-z0-9]+)/);
  if (match) return match[1].slice(0, 2).toUpperCase();
  const trimmed = nickname.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 2) : "??";
}

function Avatar({ nickname }: { nickname: string }) {
  return (
    <div
      style={{
        width: layout.avatarSize,
        height: layout.avatarSize,
        borderRadius: radius.pill,
        background: palette.brandSurface,
        color: palette.brandText,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: fontSize.subtitle,
        fontWeight: fontWeight.bold,
        flexShrink: 0,
      }}
    >
      {getAvatarInitial(nickname)}
    </div>
  );
}

function VerifiedBadge() {
  return (
    <span
      style={{
        alignSelf: "flex-start",
        padding: `${spacing.xs}px ${spacing.sm}px`,
        borderRadius: radius.sm,
        background: palette.brandSurface,
        color: palette.brandText,
        fontSize: fontSize.caption,
        fontWeight: fontWeight.medium,
      }}
    >
      ✓ 토스 인증 완료
    </span>
  );
}
