import { AlertDialog } from "@toss/tds-mobile";
import type { CSSProperties } from "react";

import { fontSize, fontWeight, palette, spacing } from "../design/tokens";
import type { ReportReason } from "../lib/db/votes";

type Props = {
  open: boolean;
  pending?: boolean;
  onSelect: (reason: ReportReason) => void;
  onClose: () => void;
};

const reasons: { key: ReportReason; label: string }[] = [
  { key: "hate", label: "혐오 / 비하 표현" },
  { key: "spam", label: "도배 / 광고" },
  { key: "sexual", label: "선정적 내용" },
  { key: "violence", label: "폭력 / 범죄 미화" },
  { key: "personal_info", label: "개인정보 노출" },
  { key: "other", label: "기타" },
];

const buttonStyle: CSSProperties = {
  fontWeight: fontWeight.medium,
  color: palette.textPrimary,
};

export function ReportDialog({ open, pending, onSelect, onClose }: Props) {
  return (
    <AlertDialog
      open={open}
      onClose={onClose}
      title="이 투표를 신고할까요?"
      description={
        <span
          style={{
            fontSize: fontSize.body,
            color: palette.textSecondary,
            lineHeight: 1.5,
          }}
        >
          어떤 점이 문제인지 알려주세요.
          <br />
          누적되면 자동으로 비공개 처리돼요.
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
          {reasons.map((r) => (
            <AlertDialog.AlertButton
              key={r.key}
              style={buttonStyle}
              disabled={pending}
              onClick={() => onSelect(r.key)}
            >
              {r.label}
            </AlertDialog.AlertButton>
          ))}
          <AlertDialog.AlertButton
            style={{ color: palette.textSecondary }}
            disabled={pending}
            onClick={onClose}
          >
            취소
          </AlertDialog.AlertButton>
        </div>
      }
    />
  );
}
