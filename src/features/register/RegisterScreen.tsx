import { Top, Toast } from "@toss/tds-mobile";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "../../components/AppShell";
import {
  fontSize,
  fontWeight,
  motion,
  palette,
  spacing,
} from "../../design/tokens";
import { CategoryPicker } from "./components/CategoryPicker";
import { ChoiceList } from "./components/ChoiceList";
import { DurationPicker } from "./components/DurationPicker";
import { QuestionInput } from "./components/QuestionInput";
import { SubmitBar } from "./components/SubmitBar";
import { TodayCandidateToggle } from "./components/TodayCandidateToggle";
import { useRegisterForm } from "./useRegisterForm";

export function RegisterScreen() {
  const navigate = useNavigate();
  const [toast, setToast] = useState<string | null>(null);

  const form = useRegisterForm({
    onSuccess: (_voteId, _payload, kind, rejectionReason) => {
      if (kind === "approved") {
        setToast("등록되었어요");
        setTimeout(() => navigate("/"), motion.toastMs);
      } else if (kind === "rejected") {
        setToast(
          rejectionReason
            ? `등록 반려: ${rejectionReason}`
            : "검열 기준에 맞지 않아 반려됐어요",
        );
      } else {
        // moderation 호출 자체가 실패 — 등록은 됐으나 검열 결과 미수신
        setToast("등록되었어요. 심사가 진행 중이에요 (마이페이지에서 결과 확인)");
        setTimeout(() => navigate("/"), motion.toastMs);
      }
    },
    onError: (outcome) => {
      setToast(outcome.message);
    },
  });

  const submitLabel = form.willUseFreePass
    ? "무료이용권으로 등록하기"
    : form.requiresAd
      ? "광고 보고 등록하기"
      : "등록하기";
  const statusText = renderStatusText(form);
  const showAdToggle = form.requiresGate && form.hasFreePass;

  return (
    <AppShell
      footer={
        <SubmitBar
          disabled={!form.canSubmit}
          loading={form.submitting}
          onSubmit={form.submit}
          label={submitLabel}
        />
      }
    >
      <Top
        title={<Top.TitleParagraph size={22}>질문 등록</Top.TitleParagraph>}
        subtitleBottom={
          <Top.SubtitleParagraph size={15}>
            대중의 평균값이 궁금한 질문을 만들어보세요
          </Top.SubtitleParagraph>
        }
      />

      {statusText !== null ? (
        <div
          style={{
            margin: `${spacing.sm}px ${spacing.lg}px ${spacing.md}px`,
            padding: `${spacing.sm}px ${spacing.md}px`,
            borderRadius: 8,
            background: form.capBlocked
              ? "#FBE9E7"
              : form.willUseFreePass
                ? "#EAF3DE"
                : form.requiresAd
                  ? "#FAEEDA"
                  : palette.surface,
            color: form.capBlocked
              ? "#712B13"
              : form.willUseFreePass
                ? "#27500A"
                : form.requiresAd
                  ? "#633806"
                  : palette.textSecondary,
            fontSize: fontSize.label,
            fontWeight: fontWeight.medium,
            lineHeight: 1.4,
          }}
        >
          {statusText}
        </div>
      ) : null}

      {showAdToggle ? (
        <div
          style={{
            margin: `0 ${spacing.lg}px ${spacing.md}px`,
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <button
            type="button"
            onClick={() => form.setForceAdMode(!form.forceAdMode)}
            style={{
              background: "transparent",
              border: 0,
              padding: 0,
              fontSize: fontSize.small,
              color: palette.textSecondary,
              textDecoration: "underline",
              cursor: "pointer",
            }}
          >
            {form.forceAdMode
              ? "← 무료이용권 사용으로 돌아가기"
              : "광고 시청으로 등록하기 →"}
          </button>
        </div>
      ) : null}

      <div style={{ paddingBottom: spacing.xxl }}>
        <QuestionInput
          value={form.question}
          errorMessage={form.errors.question}
          onChange={form.updateQuestion}
          onBlur={() => form.markTouched("question")}
        />

        <ChoiceList
          choices={form.choices}
          errorMessage={form.errors.choices}
          onChange={form.updateChoice}
          onAdd={form.addChoice}
          onRemove={form.removeChoice}
          onBlur={() => form.markTouched("choices")}
        />

        <CategoryPicker
          value={form.category}
          errorMessage={form.errors.category}
          onChange={(next) => {
            form.markTouched("category");
            form.setCategory(next);
          }}
        />

        <DurationPicker value={form.duration} onChange={form.setDuration} />

        <TodayCandidateToggle
          checked={form.todayCandidate}
          onChange={form.setTodayCandidate}
        />
      </div>

      {toast !== null ? (
        <Toast
          position="bottom"
          open
          text={toast}
          duration={motion.toastMs}
          onClose={() => setToast(null)}
        />
      ) : null}
    </AppShell>
  );
}

function renderStatusText(form: ReturnType<typeof useRegisterForm>): string | null {
  if (form.status === null) return null;
  if (form.status.registerBlocked) {
    return "현재 등록이 일시 정지된 상태예요.";
  }
  if (form.todayCandidate) {
    if (form.status.todayCandidateCapReached) {
      return "오늘의 투표 후보는 하루 1건만 등록할 수 있어요.";
    }
    return "오늘의 투표 후보 — 작성 5P, 선정 시 +30P (1인 1일 1건)";
  }
  if (form.status.normalCapReached) {
    return "오늘 등록 한도(10건)에 도달했어요. 내일 다시 시도해주세요.";
  }
  if (form.requiresGate) {
    const remaining = 10 - form.status.normalCountToday;
    if (form.willUseFreePass) {
      const balance = form.missions?.freePassBalance ?? 0;
      return `오늘 ${form.status.normalCountToday}/10 등록 — 무료이용권 1개를 사용해 등록해요 (잔량 ${balance}개)`;
    }
    return `오늘 ${form.status.normalCountToday}/10 등록 — ${remaining}건 더 등록하려면 광고 시청 또는 무료이용권이 필요해요.`;
  }
  const remainingFree = Math.max(0, 2 - form.status.normalCountToday);
  if (remainingFree > 0) {
    return `오늘 ${form.status.normalCountToday}/10 등록 — 무료 ${remainingFree}건 더 가능 (등록 시 +2P)`;
  }
  return `오늘 ${form.status.normalCountToday}/10 등록`;
}
