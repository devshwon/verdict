import { Button } from "@toss/tds-mobile";
import { useState } from "react";
import { SectionTitle } from "../../../components/SectionTitle";
import {
  borderWidth,
  fontSize,
  fontWeight,
  lineHeight,
  palette,
  radius,
  spacing,
} from "../../../design/tokens";
import { watchRewardAd } from "../../../lib/ads";
import { claimDailyAdFreePass, registerAdWatch } from "../../../lib/db/votes";

type Props = {
  balance: number;
  adClaimedToday: boolean;
  onClaimed: () => void;
  onError: (message: string) => void;
};

export function FreePassCard({
  balance,
  adClaimedToday,
  onClaimed,
  onError,
}: Props) {
  const [watching, setWatching] = useState(false);

  const handleClaim = async () => {
    if (watching || adClaimedToday) return;
    setWatching(true);
    try {
      await watchRewardAd();
      const tokenOutcome = await registerAdWatch("mypage_free_pass");
      if (!tokenOutcome.ok) {
        onError(tokenOutcome.message);
        return;
      }
      const outcome = await claimDailyAdFreePass(tokenOutcome.adToken);
      if (outcome.ok) {
        onClaimed();
      } else {
        onError(outcome.message);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      onError(msg);
    } finally {
      setWatching(false);
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
      <SectionTitle>무료이용권</SectionTitle>
      <div
        style={{
          padding: spacing.lg,
          borderRadius: radius.lg,
          background: palette.background,
          border: `${borderWidth.hairline}px solid ${palette.border}`,
          display: "flex",
          flexDirection: "column",
          gap: spacing.md,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: spacing.md,
          }}
        >
          <span aria-hidden style={{ fontSize: 28 }}>
            🎫
          </span>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: spacing.xs,
              flex: 1,
            }}
          >
            <span
              style={{
                fontSize: fontSize.heading,
                fontWeight: fontWeight.bold,
                color: palette.textPrimary,
              }}
            >
              {balance}개
            </span>
            <span
              style={{
                fontSize: fontSize.small,
                color: palette.textSecondary,
                lineHeight: lineHeight.tight,
              }}
            >
              일반 투표 등록 한도(2건) 초과 시 광고 대신 사용
            </span>
          </div>
        </div>

        <Button
          display="block"
          size="medium"
          color={adClaimedToday ? "dark" : "primary"}
          variant={adClaimedToday ? "weak" : "fill"}
          disabled={adClaimedToday || watching}
          onClick={handleClaim}
        >
          {watching
            ? "광고 시청 중…"
            : adClaimedToday
              ? "오늘은 이미 받았어요 (내일 다시)"
              : "광고 보고 1개 받기 (1일 1회)"}
        </Button>
      </div>
    </section>
  );
}
