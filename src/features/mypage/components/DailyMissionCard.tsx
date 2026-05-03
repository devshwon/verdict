import { SectionTitle } from "../../../components/SectionTitle";
import {
  borderWidth,
  controlHeight,
  fontSize,
  fontWeight,
  palette,
  radius,
  spacing,
} from "../../../design/tokens";
import type { DailyMissions, MissionProgress } from "../../../lib/db/votes";

type Props = {
  missions: DailyMissions;
};

export function DailyMissionCard({ missions }: Props) {
  return (
    <section
      style={{
        margin: `0 ${spacing.lg}px ${spacing.xl}px`,
        display: "flex",
        flexDirection: "column",
        gap: spacing.md,
      }}
      id="missions"
    >
      <SectionTitle>오늘의 미션</SectionTitle>
      <div
        style={{
          padding: spacing.md,
          borderRadius: radius.lg,
          background: palette.background,
          border: `${borderWidth.hairline}px solid ${palette.border}`,
          display: "flex",
          flexDirection: "column",
          gap: spacing.sm,
        }}
      >
        <AttendanceRow attendance={missions.attendance} />
        <Row label="일반 투표 참여 (5건)" mission={missions.normalVoteParticipation} />
        <Row label="일반 투표 등록" mission={missions.normalVoteRegister} />
        <Row
          label="오늘의 투표 후보 신청"
          mission={missions.todayCandidateRegister}
        />
      </div>
    </section>
  );
}

function AttendanceRow({
  attendance,
}: {
  attendance: DailyMissions["attendance"];
}) {
  const { attendedToday, currentStreak, nextBonusDay } = attendance;
  const daysToBonus = Math.max(0, nextBonusDay - currentStreak);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: spacing.sm,
        padding: `${spacing.xs}px 0`,
      }}
    >
      <span aria-hidden style={{ fontSize: fontSize.body }}>
        {attendedToday ? "✅" : "🔵"}
      </span>
      <span
        style={{
          flex: 1,
          fontSize: fontSize.label,
          fontWeight: fontWeight.medium,
          color: palette.textPrimary,
        }}
      >
        출석 (연속 {currentStreak}일
        {daysToBonus > 0 ? ` · ${daysToBonus}일 후 보너스` : ""})
      </span>
      <span
        style={{
          fontSize: fontSize.small,
          color: attendedToday ? palette.textTertiary : palette.brandText,
          fontWeight: fontWeight.medium,
          minWidth: 40,
          textAlign: "right",
        }}
      >
        +1P
      </span>
    </div>
  );
}

function Row({ label, mission }: { label: string; mission: MissionProgress }) {
  const ratio = mission.target > 0
    ? Math.min(100, Math.round((mission.current / mission.target) * 100))
    : 0;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: spacing.xs,
        padding: `${spacing.xs}px 0`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: spacing.sm,
        }}
      >
        <span
          aria-hidden
          style={{
            fontSize: fontSize.body,
          }}
        >
          {mission.completed ? "✅" : "🔵"}
        </span>
        <span
          style={{
            flex: 1,
            fontSize: fontSize.label,
            fontWeight: fontWeight.medium,
            color: palette.textPrimary,
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontSize: fontSize.small,
            color: palette.textSecondary,
            fontWeight: fontWeight.medium,
          }}
        >
          {mission.current}/{mission.target}
        </span>
        <span
          style={{
            fontSize: fontSize.small,
            color: mission.completed
              ? palette.textTertiary
              : palette.brandText,
            fontWeight: fontWeight.medium,
            minWidth: 40,
            textAlign: "right",
          }}
        >
          +{mission.rewardPoints}P
        </span>
      </div>
      <div
        style={{
          height: controlHeight.bar,
          borderRadius: radius.sm,
          background: palette.divider,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${ratio}%`,
            height: "100%",
            background: mission.completed
              ? palette.textTertiary
              : palette.brand,
            borderRadius: radius.sm,
            transition: "width 320ms ease",
          }}
        />
      </div>
    </div>
  );
}
