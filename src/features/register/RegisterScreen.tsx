import { Top, Toast } from "@toss/tds-mobile";
import { useState } from "react";
import { AppShell } from "../../components/AppShell";
import { motion, spacing } from "../../design/tokens";
import { CategoryPicker } from "./components/CategoryPicker";
import { ChoiceList } from "./components/ChoiceList";
import { DurationPicker } from "./components/DurationPicker";
import { QuestionInput } from "./components/QuestionInput";
import { SubmitBar } from "./components/SubmitBar";
import { TodayCandidateToggle } from "./components/TodayCandidateToggle";
import { useRegisterForm } from "./useRegisterForm";

export function RegisterScreen() {
  const [toast, setToast] = useState<string | null>(null);
  const form = useRegisterForm({
    onSuccess: () => setToast("등록되었어요"),
    onError: () => setToast("등록에 실패했어요. 잠시 후 다시 시도해주세요."),
  });

  return (
    <AppShell
      footer={
        <SubmitBar
          disabled={!form.canSubmit}
          loading={form.submitting}
          onSubmit={form.submit}
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
