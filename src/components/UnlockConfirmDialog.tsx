import { AlertDialog } from "@toss/tds-mobile";

import { fontSize, fontWeight, palette, spacing } from "../design/tokens";

type Props = {
  open: boolean;
  freePassBalance: number;
  onUseFreePass: () => void;
  onWatchAd: () => void;
  onClose: () => void;
};

/**
 * 결과 잠금 해제 시 무료이용권 vs 광고 시청 선택 다이얼로그.
 * - 잔량이 1개 이상일 때만 호출 (잔량 0이면 호출부에서 바로 광고로 진입)
 */
export function UnlockConfirmDialog({
  open,
  freePassBalance,
  onUseFreePass,
  onWatchAd,
  onClose,
}: Props) {
  return (
    <AlertDialog
      open={open}
      onClose={onClose}
      title="결과 잠금 해제"
      description={
        <span
          style={{
            fontSize: fontSize.body,
            color: palette.textSecondary,
            lineHeight: 1.5,
          }}
        >
          무료이용권 {freePassBalance}개 보유 중이에요.
          <br />
          어떻게 열까요?
        </span>
      }
      alertButton={
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: spacing.xs,
            width: "100%",
          }}
        >
          <AlertDialog.AlertButton
            style={{
              fontWeight: fontWeight.bold,
              color: palette.textPrimary,
            }}
            onClick={() => {
              onUseFreePass();
              onClose();
            }}
          >
            무료이용권 사용 (1개 차감)
          </AlertDialog.AlertButton>
          <AlertDialog.AlertButton
            style={{ color: palette.textSecondary }}
            onClick={() => {
              onWatchAd();
              onClose();
            }}
          >
            광고 보고 열기 (이용권 아끼기)
          </AlertDialog.AlertButton>
        </div>
      }
    />
  );
}
