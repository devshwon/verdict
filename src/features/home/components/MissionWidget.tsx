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
  // 받을 보상 건수 — 0 보다 크면 우측 CTA 가 "받으러 가기 ›" 로 강조
  unclaimedCount?: number;
};

export function MissionWidget({ missions, unclaimedCount = 0 }: Props) {
  const navigate = useNavigate();
  if (!missions) return null;
  const hasUnclaimed = unclaimedCount > 0;

  const completed =
    (missions.attendance.attendedToday ? 1 : 0) +
    (missions.normalVoteParticipation.completed ? 1 : 0) +
    (missions.normalVoteRegister.completed ? 1 : 0) +
    (missions.todayCandidateRegister.completed ? 1 : 0);
  const total = 4;

  return (
    <button
      type="button"
      onClick={() => navigate("/mypage")}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        width: `calc(100% - ${spacing.lg * 2}px)`,
        margin: `-${spacing.sm}px ${spacing.lg}px ${spacing.xs}px`,
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
      {hasUnclaimed ? (
        <span
          style={{
            fontSize: fontSize.label,
            color: palette.brandText,
            fontWeight: fontWeight.bold,
            whiteSpace: "nowrap",
          }}
        >
          받으러 가기 ›
        </span>
      ) : (
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
      )}
    </button>
  );
}
