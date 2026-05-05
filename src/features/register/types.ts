import type { RegisterCategoryKey } from "../../design/tokens";

export type RegisterCategory = RegisterCategoryKey;

export type DurationKey = "m5" | "m10" | "m30" | "h1";

export const durations: { key: DurationKey; label: string }[] = [
  { key: "m5", label: "5분" },
  { key: "m10", label: "10분" },
  { key: "m30", label: "30분" },
  { key: "h1", label: "1시간" },
];

export const QUESTION_MIN_LENGTH = 4;
export const QUESTION_MAX_LENGTH = 60;
export const CHOICE_MAX_LENGTH = 30;
export const MIN_CHOICES = 2;
export const MAX_CHOICES = 5;

export type Choice = { id: string; value: string };

export type RegisterPayload = {
  question: string;
  choices: string[];
  category: RegisterCategory;
  duration: DurationKey;
  todayCandidate: boolean;
};

export type FieldKey = "question" | "choices" | "category";

export type RegisterErrors = Partial<Record<FieldKey, string>>;
export type TouchedMap = Partial<Record<FieldKey, boolean>>;
