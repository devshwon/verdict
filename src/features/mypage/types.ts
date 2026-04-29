import type { CategoryKey } from "../../design/tokens";

export type Profile = {
  nickname: string;
  tossVerified: boolean;
};

export type MyStats = {
  created: number;
  participated: number;
  featured: number;
};

export type MyVoteStatus = "ongoing" | "closed";

export type MyVote = {
  id: string;
  category: Exclude<CategoryKey, "all">;
  question: string;
  participants: number;
  status: MyVoteStatus;
  remainingLabel?: string;
};

export type ParticipatedVote = {
  id: string;
  category: Exclude<CategoryKey, "all">;
  question: string;
  participants: number;
  myChoice: string;
  majorityChoice: string;
  matched: boolean;
};
