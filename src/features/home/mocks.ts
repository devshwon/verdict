import type { FeedVote, PastTodayVote, TodayVote } from "./types";

export const todayVotes: Record<TodayVote["category"], TodayVote> = {
  daily: {
    id: "today-daily",
    category: "daily",
    question: "야근 수당 없는 야근, 그냥 해?",
    participants: 3204,
    remainingLabel: "02:14:33 남음",
  },
  game: {
    id: "today-game",
    category: "game",
    question: "픽창에서 비매너 보면 바로 닷지?",
    participants: 1872,
    remainingLabel: "05:42:11 남음",
  },
  love: {
    id: "today-love",
    category: "love",
    question: "썸 탈 때 답장 1시간 넘으면 식은 거야?",
    participants: 2410,
    remainingLabel: "03:08:55 남음",
  },
  work: {
    id: "today-work",
    category: "work",
    question: "퇴근 후 업무 카톡, 답해야 할까?",
    participants: 4120,
    remainingLabel: "01:55:09 남음",
  },
};

const pastTodayVotesRaw: PastTodayVote[] = [
  {
    id: "past-today-1",
    category: "daily",
    question: "엘베에서 모르는 사람과 인사, 해야 해?",
    participants: 5210,
    endedAt: "2026-04-29",
    unlocked: false,
  },
  {
    id: "past-today-2",
    category: "love",
    question: "데이트 비용, 더치페이가 기본?",
    participants: 4880,
    endedAt: "2026-04-28",
    unlocked: false,
  },
  {
    id: "past-today-3",
    category: "work",
    question: "월요일 오전 회의, 폐지가 답?",
    participants: 6120,
    endedAt: "2026-04-27",
    unlocked: true,
  },
  {
    id: "past-today-4",
    category: "game",
    question: "솔로랭크 듀오, 매너 위반?",
    participants: 3340,
    endedAt: "2026-04-26",
    unlocked: false,
  },
  {
    id: "past-today-5",
    category: "daily",
    question: "지하철에서 통화, 매너 위반?",
    participants: 4012,
    endedAt: "2026-04-25",
    unlocked: false,
  },
  {
    id: "past-today-6",
    category: "love",
    question: "전 애인 SNS 팔로우, 정상?",
    participants: 2980,
    endedAt: "2026-04-24",
    unlocked: false,
  },
  {
    id: "past-today-7",
    category: "work",
    question: "점심 혼밥, 회사에서 해도 돼?",
    participants: 3560,
    endedAt: "2026-04-23",
    unlocked: false,
  },
];

export const pastTodayVotes: PastTodayVote[] = [...pastTodayVotesRaw].sort(
  (a, b) => b.endedAt.localeCompare(a.endedAt)
);

export function getRecentPastVotes(
  category: PastTodayVote["category"] | "all" | "etc",
  limit = 5
): PastTodayVote[] {
  if (category === "etc") return [];
  if (category === "all") return pastTodayVotes.slice(0, limit);
  return pastTodayVotes.filter((v) => v.category === category).slice(0, limit);
}

export const feedVotes: FeedVote[] = [
  {
    id: "feed-1",
    category: "game",
    tag: "popular",
    question: "캐리 못하면 트롤인가?",
    participants: 892,
    remainingLabel: "12시간 남음",
    options: [
      { id: "a", label: "그렇다", ratio: 61 },
      { id: "b", label: "아니다", ratio: 39 },
    ],
    showResultBar: true,
  },
  {
    id: "feed-2",
    category: "love",
    tag: "new",
    question: "첫 만남 더치페이, 괜찮아?",
    participants: 124,
    remainingLabel: "45분 남음",
    options: [
      { id: "a", label: "괜찮다", ratio: 0 },
      { id: "b", label: "아니다", ratio: 0 },
    ],
    showResultBar: false,
  },
  {
    id: "feed-3",
    category: "work",
    tag: "closed",
    question: "상사 욕 뒤에서 하는 거 나쁜가?",
    participants: 1120,
    remainingLabel: "마감",
    options: [
      { id: "a", label: "나쁘다", ratio: 28 },
      { id: "b", label: "아니다", ratio: 72 },
    ],
    showResultBar: true,
  },
  {
    id: "feed-4",
    category: "daily",
    tag: "popular",
    question: "카톡 읽씹, 화가 나?",
    participants: 2480,
    remainingLabel: "6시간 남음",
    options: [
      { id: "a", label: "화남", ratio: 54 },
      { id: "b", label: "괜찮음", ratio: 46 },
    ],
    showResultBar: true,
  },
  {
    id: "feed-5",
    category: "daily",
    tag: "new",
    question: "지하철에서 다리 꼬는 거 매너 위반?",
    participants: 88,
    remainingLabel: "30분 남음",
    options: [
      { id: "a", label: "매너 위반", ratio: 0 },
      { id: "b", label: "괜찮음", ratio: 0 },
    ],
    showResultBar: false,
  },
  {
    id: "feed-6",
    category: "game",
    tag: "closed",
    question: "랭크 게임 중 채팅 끄는 게 매너?",
    participants: 740,
    remainingLabel: "마감",
    options: [
      { id: "a", label: "매너", ratio: 67 },
      { id: "b", label: "비매너", ratio: 33 },
    ],
    showResultBar: true,
  },
  {
    id: "feed-7",
    category: "love",
    tag: "popular",
    question: "사귀기 전 SNS 다 정리해야 해?",
    participants: 1560,
    remainingLabel: "9시간 남음",
    options: [
      { id: "a", label: "정리해야", ratio: 42 },
      { id: "b", label: "필요 없다", ratio: 58 },
    ],
    showResultBar: true,
  },
  {
    id: "feed-8",
    category: "work",
    tag: "new",
    question: "회식에서 1차만 가도 욕 먹을까?",
    participants: 60,
    remainingLabel: "1시간 남음",
    options: [
      { id: "a", label: "괜찮다", ratio: 0 },
      { id: "b", label: "눈치 보임", ratio: 0 },
    ],
    showResultBar: false,
  },
  {
    id: "feed-9",
    category: "etc",
    tag: "popular",
    question: "민트초코, 음식이 맞아?",
    participants: 5023,
    remainingLabel: "3시간 남음",
    options: [
      { id: "a", label: "맞다", ratio: 48 },
      { id: "b", label: "아니다", ratio: 52 },
    ],
    showResultBar: true,
  },
  {
    id: "feed-10",
    category: "etc",
    tag: "closed",
    question: "엘리베이터에서 인사 꼭 해야 해?",
    participants: 980,
    remainingLabel: "마감",
    options: [
      { id: "a", label: "한다", ratio: 36 },
      { id: "b", label: "안 한다", ratio: 64 },
    ],
    showResultBar: true,
  },
];
