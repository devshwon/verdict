import type { RegisterCategoryKey } from "../../design/tokens";

export type RegisterCategory = RegisterCategoryKey;

export type DurationKey = "m10" | "m30" | "h1" | "h6" | "h24";

export const durations: { key: DurationKey; label: string }[] = [
  { key: "m10", label: "10분" },
  { key: "m30", label: "30분" },
  { key: "h1", label: "1시간" },
  { key: "h6", label: "6시간" },
  { key: "h24", label: "24시간" },
];

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
