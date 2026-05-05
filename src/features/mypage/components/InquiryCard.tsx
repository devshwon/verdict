import { Button, TextField } from "@toss/tds-mobile";
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
import {
  createInquiry,
  INQUIRY_MAX_LENGTH,
  INQUIRY_MIN_LENGTH,
  INQUIRY_NICKNAME_MAX_LENGTH,
} from "../../../lib/db/inquiries";

type Props = {
  onSubmitted: () => void;
  onError: (message: string) => void;
};

export function InquiryCard({ onSubmitted, onError }: Props) {
  const [open, setOpen] = useState(false);
  const [nickname, setNickname] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const trimmed = message.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < INQUIRY_MIN_LENGTH;
  const canSubmit =
    !submitting &&
    trimmed.length >= INQUIRY_MIN_LENGTH &&
    trimmed.length <= INQUIRY_MAX_LENGTH;

  const reset = () => {
    setMessage("");
    setNickname("");
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    const outcome = await createInquiry(message, nickname);
    setSubmitting(false);
    if (!outcome.ok) {
      onError(outcome.message);
      return;
    }
    reset();
    setOpen(false);
    onSubmitted();
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
      <SectionTitle>문의 남기기</SectionTitle>
      <div
        style={{
          padding: spacing.md,
          borderRadius: radius.md,
          background: palette.surface,
          border: `${borderWidth.hairline}px solid ${palette.border}`,
          display: "flex",
          flexDirection: "column",
          gap: spacing.sm,
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: fontSize.label,
            color: palette.textSecondary,
            lineHeight: lineHeight.body,
          }}
        >
          버그·제안·기타 의견을 남겨주세요. 답변은 따로 드리지 않지만 운영에
          참고하고 있어요.
        </p>
        {open ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: spacing.sm,
            }}
          >
            <TextField
              variant="box"
              label="닉네임 (선택)"
              labelOption="sustain"
              placeholder="비워두셔도 괜찮아요"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              maxLength={INQUIRY_NICKNAME_MAX_LENGTH}
            />
            <label
              style={{
                fontSize: fontSize.label,
                fontWeight: fontWeight.medium,
                color: palette.textSecondary,
              }}
            >
              문의 내용
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, INQUIRY_MAX_LENGTH))}
              placeholder={`${INQUIRY_MIN_LENGTH}자 이상 ${INQUIRY_MAX_LENGTH}자 이내로 적어주세요`}
              rows={5}
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: spacing.md,
                borderRadius: radius.sm,
                border: `${borderWidth.hairline}px solid ${
                  tooShort ? palette.brand : palette.border
                }`,
                background: palette.background,
                color: palette.textPrimary,
                fontSize: fontSize.body,
                lineHeight: lineHeight.body,
                resize: "vertical",
                fontFamily: "inherit",
                outline: "none",
              }}
            />
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontSize: fontSize.small,
                color: tooShort ? palette.brand : palette.textTertiary,
              }}
            >
              <span>
                {tooShort ? `${INQUIRY_MIN_LENGTH}자 이상 입력해주세요` : ""}
              </span>
              <span>
                {trimmed.length} / {INQUIRY_MAX_LENGTH}자
              </span>
            </div>
            <div style={{ display: "flex", gap: spacing.sm }}>
              <Button
                size="medium"
                variant="weak"
                color="dark"
                disabled={submitting}
                onClick={() => {
                  reset();
                  setOpen(false);
                }}
              >
                취소
              </Button>
              <Button
                size="medium"
                variant="fill"
                color="primary"
                disabled={!canSubmit}
                onClick={() => void handleSubmit()}
              >
                {submitting ? "보내는 중…" : "보내기"}
              </Button>
            </div>
          </div>
        ) : (
          <Button
            size="medium"
            variant="weak"
            color="dark"
            onClick={() => setOpen(true)}
          >
            문의 작성하기
          </Button>
        )}
      </div>
    </section>
  );
}
