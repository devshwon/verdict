import { useState } from "react";
import { SectionTitle } from "../../../components/SectionTitle";
import {
  borderWidth,
  fontSize,
  fontWeight,
  palette,
  radius,
  spacing,
} from "../../../design/tokens";
import {
  claimAllUnclaimedPoints,
  claimPoints,
  payoutSelfPending,
  type UnclaimedPoint,
} from "../../../lib/db/votes";

type Props = {
  rewards: UnclaimedPoint[];
  // immediate=true 면 즉시 토스 지급 완료, false 면 신청만 됐고 5분 안에 자동 지급 예정
  onClaimed: (count: number, totalAmount: number, immediate: boolean) => void;
  onError: (message: string) => void;
};

const TRIGGER_LABEL: Record<string, string> = {
  normal_daily_5vote_complete: "5건 투표 완료",
  normal_streak_10day: "10일 연속 출석",
  normal_streak_20day: "20일 연속 출석",
  normal_streak_30plus: "장기 출석 보너스",
  normal_vote_register: "질문 등록",
  today_candidate_register: "오늘의 투표 후보 신청",
  today_selection: "오늘의 투표 당선",
  normal_100_participants_bonus: "100명 달성 보너스",
};

function relativeRemaining(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "곧 만료";
  const hours = Math.floor(ms / (60 * 60 * 1000));
  const days = Math.floor(hours / 24);
  if (days >= 1) return `${days}일 후 만료`;
  return `${hours}시간 후 만료`;
}

export function ClaimRewardsCard({ rewards, onClaimed, onError }: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [claimingAll, setClaimingAll] = useState(false);

  if (rewards.length === 0) return null;

  const totalAmount = rewards.reduce((s, r) => s + r.amount, 0);

  const handleClaim = async (id: string, amount: number) => {
    if (busyId !== null) return;
    setBusyId(id);
    try {
      const count = await claimPoints([id]);
      if (count > 0) {
        // claim 직후 자기 user 의 pending 즉시 토스 지급 시도 (실패 시 cron 5분 fallback)
        const payout = await payoutSelfPending();
        onClaimed(count, amount, payout.immediate && payout.succeeded > 0);
      } else {
        onClaimed(count, 0, false);
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const handleClaimAll = async () => {
    if (claimingAll) return;
    setClaimingAll(true);
    try {
      const { claimedCount, totalAmount: amt } = await claimAllUnclaimedPoints();
      if (claimedCount > 0) {
        const payout = await payoutSelfPending();
        onClaimed(claimedCount, amt, payout.immediate && payout.succeeded > 0);
      } else {
        onClaimed(claimedCount, amt, false);
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setClaimingAll(false);
    }
  };

  return (
    <section
      style={{
        margin: `0 ${spacing.lg}px ${spacing.xl}px`,
        display: "flex",
        flexDirection: "column",
        gap: spacing.md,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <SectionTitle>받을 보상 {rewards.length}건 · {totalAmount}P</SectionTitle>
        <button
          type="button"
          onClick={() => void handleClaimAll()}
          disabled={claimingAll}
          style={{
            padding: `${spacing.xs}px ${spacing.md}px`,
            borderRadius: radius.pill,
            border: 0,
            background: claimingAll ? palette.divider : palette.brand,
            color: claimingAll ? palette.textTertiary : "#FFFFFF",
            fontSize: fontSize.small,
            fontWeight: fontWeight.bold,
            cursor: claimingAll ? "default" : "pointer",
          }}
        >
          {claimingAll ? "받는 중…" : "모두 받기"}
        </button>
      </div>
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
        {rewards.map((r) => (
          <div
            key={r.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: spacing.sm,
              padding: `${spacing.xs}px 0`,
            }}
          >
            <span aria-hidden style={{ fontSize: fontSize.body }}>
              🎁
            </span>
            <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
              <span
                style={{
                  fontSize: fontSize.label,
                  fontWeight: fontWeight.medium,
                  color: palette.textPrimary,
                }}
              >
                {TRIGGER_LABEL[r.trigger] ?? r.trigger}
              </span>
              <span
                style={{
                  fontSize: fontSize.small,
                  color: palette.textTertiary,
                }}
              >
                +{r.amount}P · {relativeRemaining(r.expiresAt)}
              </span>
            </div>
            <button
              type="button"
              onClick={() => void handleClaim(r.id, r.amount)}
              disabled={busyId !== null}
              style={{
                padding: `${spacing.xs}px ${spacing.md}px`,
                borderRadius: radius.pill,
                border: `${borderWidth.hairline}px solid ${palette.brand}`,
                background:
                  busyId === r.id ? palette.divider : palette.brandSurface,
                color: palette.brandText,
                fontSize: fontSize.small,
                fontWeight: fontWeight.medium,
                cursor: busyId !== null ? "default" : "pointer",
                opacity: busyId !== null && busyId !== r.id ? 0.5 : 1,
              }}
            >
              {busyId === r.id ? "받는 중…" : "받기"}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
