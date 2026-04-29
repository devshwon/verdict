import { Top } from "@toss/tds-mobile";
import { palette, spacing } from "../../design/tokens";
import { CategoryPicker } from "./components/CategoryPicker";
import { ChoiceList } from "./components/ChoiceList";
import { DurationPicker } from "./components/DurationPicker";
import { QuestionInput } from "./components/QuestionInput";
import { SubmitBar } from "./components/SubmitBar";
import { TodayCandidateToggle } from "./components/TodayCandidateToggle";
import { useRegisterForm } from "./useRegisterForm";

export function RegisterScreen() {
  const form = useRegisterForm();

  return (
    <div
      style={{
        background: palette.surface,
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Top
        title={<Top.TitleParagraph size={20}>질문 등록</Top.TitleParagraph>}
        subtitleBottom={
          <Top.SubtitleParagraph size={14}>
            대중의 평균값이 궁금한 질문을 만들어보세요
          </Top.SubtitleParagraph>
        }
      />

      <div style={{ flex: 1, paddingBottom: spacing.xxl }}>
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

        <DurationPicker
          value={form.duration}
          onChange={form.setDuration}
        />

        <TodayCandidateToggle
          checked={form.todayCandidate}
          onChange={form.setTodayCandidate}
        />
      </div>

      <SubmitBar
        disabled={!form.canSubmit}
        loading={form.submitting}
        onSubmit={form.submit}
      />
    </div>
  );
}
