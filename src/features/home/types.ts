import type { CategoryKey, FeedTagKey } from "../../design/tokens";

export type VoteOption = {
  id: string;
  label: string;
  ratio: number;
  count: number;
};

export type FeedVote = {
  id: string;
  category: Exclude<CategoryKey, "all">;
  tag: FeedTagKey;
  question: string;
  participants: number;
  remainingLabel: string;
  options: VoteOption[];
  showResultBar: boolean;
};

export type TodayVote = {
  id: string;
  category: Exclude<CategoryKey, "all" | "etc">;
  question: string;
  participants: number;
  remainingLabel: string;
};

export type PastTodayVote = {
  id: string;
  category: Exclude<CategoryKey, "all" | "etc">;
  question: string;
  participants: number;
  endedAt: string;
  unlocked: boolean;
};
