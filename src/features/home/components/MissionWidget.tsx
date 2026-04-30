import { useNavigate } from "react-router-dom";
import {
  borderWidth,
  fontSize,
  fontWeight,
  palette,
  radius,
  spacing,
} from "../../../design/tokens";
import type { DailyMissions } from "../../../lib/db/votes";

type Props = {
  missions: DailyMissions | null;
};

export function MissionWidget({ missions }: Props) {
  const navigate = useNavigate();
  if (!missions) return null;

  const completed =
    (missions.normalVoteParticipation.completed ? 1 : 0) +
    (missions.normalVoteRegister.completed ? 1 : 0) +
    (missions.todayCandidateRegister.completed ? 1 : 0);
  const total = 3;

  return (
    <button
      type="button"
      onClick={() => navigate("/mypage")}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        width: `calc(100% - ${spacing.lg * 2}px)`,
        margin: `${spacing.sm}px ${spacing.lg}px ${spacing.xs}px`,
        padding: `${spacing.sm}px ${spacing.md}px`,
        borderRadius: radius.md,
        border: `${borderWidth.hairline}px solid ${palette.border}`,
        background: palette.surface,
        cursor: "pointer",
        gap: spacing.md,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: spacing.md,
          flex: 1,
        }}
      >
        <span
          aria-hidden
          style={{ fontSize: fontSize.iconLarge }}
        >
          🎯
        </span>
        <span
          style={{
            fontSize: fontSize.label,
            fontWeight: fontWeight.medium,
            color: palette.textPrimary,
          }}
        >
          오늘의 미션 {completed}/{total}
        </span>
        <span
          style={{
            width: 1,
            height: 12,
            background: palette.divider,
          }}
          aria-hidden
        />
        <span aria-hidden style={{ fontSize: fontSize.iconLarge }}>
          🎫
        </span>
        <span
          style={{
            fontSize: fontSize.label,
            fontWeight: fontWeight.medium,
            color: palette.textPrimary,
          }}
        >
          무료이용권 {missions.freePassBalance}개
        </span>
      </div>
      <span
        aria-hidden
        style={{
          fontSize: fontSize.label,
          color: palette.textTertiary,
          fontWeight: fontWeight.medium,
        }}
      >
        ›
      </span>
    </button>
  );
}
