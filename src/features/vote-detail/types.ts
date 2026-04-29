import type { CategoryKey } from "../../design/tokens";

export type DemographicBucket = {
  key: string;
  label: string;
  optionRatios: Record<string, number>;
  participants: number;
};

export type VoteDetailOption = {
  id: string;
  label: string;
  ratio: number;
};

export type VoteDetail = {
  id: string;
  category: Exclude<CategoryKey, "all">;
  question: string;
  participants: number;
  remainingLabel: string;
  isClosed: boolean;
  options: VoteDetailOption[];
  byGender: DemographicBucket[];
  byAge: DemographicBucket[];
};
