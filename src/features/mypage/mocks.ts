import type { MyStats, MyVote, ParticipatedVote, Profile } from "./types";

export const profile: Profile = {
  nickname: "판정단 #A12F",
  tossVerified: true,
};

export const myStats: MyStats = {
  created: 7,
  participated: 42,
  featured: 1,
};

export const myVotes: MyVote[] = [
  {
    id: "mine-1",
    category: "daily",
    question: "주말에 알람 맞춰 일어나는 거 부지런한 거야?",
    participants: 312,
    status: "ongoing",
    remainingLabel: "4시간 남음",
  },
  {
    id: "mine-2",
    category: "love",
    question: "1주년 선물, 꼭 해야 해?",
    participants: 128,
    status: "ongoing",
    remainingLabel: "21시간 남음",
  },
  {
    id: "mine-3",
    category: "work",
    question: "점심시간에 헬스장 가는 거 눈치 보여?",
    participants: 904,
    status: "closed",
  },
  {
    id: "mine-4",
    category: "game",
    question: "랭크 5연패하면 그날은 접는 게 맞아?",
    participants: 1582,
    status: "closed",
  },
];

export const participatedVotes: ParticipatedVote[] = [
  {
    id: "part-1",
    category: "daily",
    question: "카톡 읽씹, 화가 나?",
    participants: 2480,
    myChoice: "화남",
    majorityChoice: "화남",
    matched: true,
  },
  {
    id: "part-2",
    category: "love",
    question: "첫 만남 더치페이, 괜찮아?",
    participants: 980,
    myChoice: "괜찮다",
    majorityChoice: "아니다",
    matched: false,
  },
  {
    id: "part-3",
    category: "game",
    question: "캐리 못하면 트롤인가?",
    participants: 892,
    myChoice: "그렇다",
    majorityChoice: "그렇다",
    matched: true,
  },
  {
    id: "part-4",
    category: "work",
    question: "상사 욕 뒤에서 하는 거 나쁜가?",
    participants: 1120,
    myChoice: "나쁘다",
    majorityChoice: "아니다",
    matched: false,
  },
  {
    id: "part-5",
    category: "etc",
    question: "민트초코, 음식이 맞아?",
    participants: 5023,
    myChoice: "맞다",
    majorityChoice: "아니다",
    matched: false,
  },
];
