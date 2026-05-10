import { useState } from "react";
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
  payoutSelfPending,
  type UnclaimedPoint,
} from "../../../lib/db/votes";

type Props = {
  rewards: UnclaimedPoint[];
  // immediate=true 면 즉시 토스 지급 완료, false 면 신청만 (5분 cron fallback)
  onClaimed: (immediate: boolean) => void;
};

export function ClaimRewardsBanner({ rewards, onClaimed }: Props) {
  const [busy, setBusy] = useState(false);
  if (rewards.length === 0) return null;

  const totalAmount = rewards.reduce((s, r) => s + r.amount, 0);

  const handleClaim = async () => {
    if (busy) return;
    setBusy(true);
    let immediate = false;
    try {
      const { claimedCount } = await claimAllUnclaimedPoints();
      if (claimedCount > 0) {
        const payout = await payoutSelfPending();
        immediate = payout.immediate && payout.succeeded > 0;
      }
    } finally {
      setBusy(false);
      onClaimed(immediate);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: spacing.md,
        width: `calc(100% - ${spacing.lg * 2}px)`,
        margin: `-${spacing.sm}px ${spacing.lg}px ${spacing.xs}px`,
        padding: `${spacing.sm}px ${spacing.md}px`,
        borderRadius: radius.md,
        border: `${borderWidth.hairline}px solid ${palette.brand}`,
        background: palette.brandSurface,
      }}
    >
      <span aria-hidden style={{ fontSize: fontSize.iconLarge }}>
        🎁
      </span>
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <span
          style={{
            fontSize: fontSize.label,
            fontWeight: fontWeight.bold,
            color: palette.brandText,
          }}
        >
          받을 보상 {rewards.length}건 · {totalAmount}P
        </span>
        <span
          style={{
            fontSize: fontSize.small,
            color: palette.textSecondary,
          }}
        >
          7일 내 받지 않으면 만료돼요
        </span>
      </div>
      <button
        type="button"
        onClick={() => void handleClaim()}
        disabled={busy}
        style={{
          padding: `${spacing.xs}px ${spacing.md}px`,
          borderRadius: radius.pill,
          border: 0,
          background: busy ? palette.divider : palette.brand,
          color: busy ? palette.textTertiary : "#FFFFFF",
          fontSize: fontSize.small,
          fontWeight: fontWeight.bold,
          cursor: busy ? "default" : "pointer",
        }}
      >
        {busy ? "받는 중…" : "모두 받기"}
      </button>
    </div>
  );
}
