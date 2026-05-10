import { AlertDialog } from "@toss/tds-mobile";

import { fontSize, fontWeight, palette, spacing } from "../../../design/tokens";

type Props = {
  open: boolean;
  freePassBalance: number;
  onUseFreePass: () => void;
  onWatchAd: () => void;
  onClose: () => void;
};

/**
 * 오늘의 투표 후보 신청 시 광고/이용권 선택 다이얼로그.
 * - freePassBalance === 0 이면 "무료이용권 사용하여 등록하기" 버튼 자체를 숨김.
 */
export function TodayCandidateChoiceDialog({
  open,
  freePassBalance,
  onUseFreePass,
  onWatchAd,
  onClose,
}: Props) {
  const hasFreePass = freePassBalance > 0;
  return (
    <AlertDialog
      open={open}
      onClose={onClose}
      title="오늘의 투표 후보 신청"
      description={
        <span
          style={{
            fontSize: fontSize.body,
            color: palette.textSecondary,
            lineHeight: 1.5,
          }}
        >
          {hasFreePass ? (
            <>
              무료이용권 {freePassBalance}개 보유 중이에요.
              <br />
              어떻게 등록할까요?
            </>
          ) : (
            <>광고를 보고 후보로 신청할 수 있어요.</>
          )}
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
          {hasFreePass ? (
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
              무료이용권 사용
            </AlertDialog.AlertButton>
          ) : null}
          <AlertDialog.AlertButton
            style={{
              fontWeight: hasFreePass ? undefined : fontWeight.bold,
              color: hasFreePass ? palette.textSecondary : palette.textPrimary,
            }}
            onClick={() => {
              onWatchAd();
              onClose();
            }}
          >
            광고 보고 등록하기
          </AlertDialog.AlertButton>
        </div>
      }
    />
  );
}
