import { feedVotes, todayVotes } from "../home/mocks";
import type { DemographicBucket, VoteDetail } from "./types";

function buildGender(
  options: { id: string }[],
  base: Record<string, number>,
  drift: number,
): DemographicBucket[] {
  const [a, b] = options;
  const maleA = clamp(base[a.id] + drift);
  const femaleA = clamp(base[a.id] - drift);
  return [
    {
      key: "male",
      label: "남성",
      participants: 0,
      optionRatios: { [a.id]: maleA, [b.id]: 100 - maleA },
    },
    {
      key: "female",
      label: "여성",
      participants: 0,
      optionRatios: { [a.id]: femaleA, [b.id]: 100 - femaleA },
    },
  ];
}

function buildAge(
  options: { id: string }[],
  base: Record<string, number>,
): DemographicBucket[] {
  const [a, b] = options;
  const ageDrift: Record<string, number> = {
    "20s": -8,
    "30s": 2,
    "40plus": 9,
  };
  return (["20s", "30s", "40plus"] as const).map((key) => {
    const label = key === "20s" ? "20대" : key === "30s" ? "30대" : "40대+";
    const ratioA = clamp(base[a.id] + ageDrift[key]);
    return {
      key,
      label,
      participants: 0,
      optionRatios: { [a.id]: ratioA, [b.id]: 100 - ratioA },
    };
  });
}

// 0%/100% 양극단 회피 — mock 데이터에서 시각적 균형 유지
function clamp(n: number) {
  return Math.max(2, Math.min(98, Math.round(n)));
}

const detailMap: Record<string, VoteDetail> = {};

for (const v of feedVotes) {
  const base: Record<string, number> = {};
  for (const opt of v.options) base[opt.id] = opt.ratio || 50;
  detailMap[v.id] = {
    id: v.id,
    category: v.category,
    question: v.question,
    participants: v.participants,
    remainingLabel: v.remainingLabel,
    isClosed: v.tag === "closed",
    options: v.options.map((o) => ({ id: o.id, label: o.label, ratio: o.ratio })),
    byGender: buildGender(v.options, base, 7),
    byAge: buildAge(v.options, base),
  };
}

for (const v of Object.values(todayVotes)) {
  const opts = [
    { id: "a", label: "그렇다", ratio: 58 },
    { id: "b", label: "아니다", ratio: 42 },
  ];
  const base: Record<string, number> = { a: 58, b: 42 };
  detailMap[v.id] = {
    id: v.id,
    category: v.category,
    question: v.question,
    participants: v.participants,
    remainingLabel: v.remainingLabel,
    isClosed: false,
    options: opts,
    byGender: buildGender(opts, base, 9),
    byAge: buildAge(opts, base),
  };
}

export function getVoteDetail(id: string): VoteDetail | null {
  return detailMap[id] ?? null;
}
