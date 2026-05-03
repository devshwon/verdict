import { supabase } from "../../config/supabase";
import type { CategoryKey } from "../../design/tokens";
import type {
  FeedVote,
  PastTodayVote,
  TodayVote,
  VoteOption,
} from "../../features/home/types";
import type {
  DemographicBucket,
  VoteDetail,
} from "../../features/vote-detail/types";
import {
  getMyCast as getMyCachedCast,
  hasMyCast as hasMyCachedCast,
} from "../voteCache";

type DbCategory = "daily" | "relationship" | "work" | "game" | "etc";
type UiCategoryNoAll = Exclude<CategoryKey, "all">;

const DB_TO_UI: Record<DbCategory, UiCategoryNoAll> = {
  daily: "daily",
  relationship: "love",
  work: "work",
  game: "game",
  etc: "etc",
};

const UI_TO_DB: Record<UiCategoryNoAll, DbCategory> = {
  daily: "daily",
  love: "relationship",
  work: "work",
  game: "game",
  etc: "etc",
};

type VoteRow = {
  id: string;
  category: DbCategory;
  status: "pending_review" | "active" | "closed" | "blinded" | "deleted";
  type: "normal" | "today" | "today_candidate";
  question: string;
  started_at: string;
  closed_at: string;
  today_published_date: string | null;
  participants_count: number;
};

const VOTE_COLS =
  "id, category, status, type, question, started_at, closed_at, today_published_date, participants_count";

type OptionRow = {
  id: string;
  vote_id: string;
  option_text: string;
  display_order: number;
};

type ResultRow = {
  vote_id: string;
  option_id: string;
  total_count: number;
  male_count: number;
  female_count: number;
  age_20s: number;
  age_30s: number;
  age_40plus: number;
  age_undisclosed: number;
};

type CastRow = {
  vote_id: string;
  option_id: string;
};

const FEED_LIMIT = 30;
const PAST_TODAY_LIMIT = 5;
const POPULAR_THRESHOLD = 500;

export function formatRemainingLabel(closedAt: Date, now = new Date()): string {
  const diffMs = closedAt.getTime() - now.getTime();
  if (diffMs <= 0) return "마감";
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 60) return `${diffMin}분 남음`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}시간 남음`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}일 남음`;
}

function isClosedNow(row: VoteRow, now = new Date()): boolean {
  return row.status === "closed" || new Date(row.closed_at) <= now;
}

async function getCurrentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

async function fetchVotesWithOptions(
  voteIds: string[]
): Promise<Map<string, OptionRow[]>> {
  if (voteIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from("vote_options")
    .select("id, vote_id, option_text, display_order")
    .in("vote_id", voteIds)
    .order("display_order", { ascending: true });
  if (error) throw error;
  const map = new Map<string, OptionRow[]>();
  for (const row of (data ?? []) as OptionRow[]) {
    const arr = map.get(row.vote_id) ?? [];
    arr.push(row);
    map.set(row.vote_id, arr);
  }
  return map;
}

async function fetchResults(
  voteIds: string[]
): Promise<Map<string, ResultRow[]>> {
  if (voteIds.length === 0) return new Map();
  // RLS 게이트: get_vote_results RPC는 본인 cast / unlock / author 한해서만 행 반환.
  // 권한 없는 vote_id는 응답에서 누락되므로 클라이언트에서 0으로 대체.
  const { data, error } = await supabase.rpc("get_vote_results", {
    p_vote_ids: voteIds,
  });
  if (error) throw error;
  const map = new Map<string, ResultRow[]>();
  for (const row of (data ?? []) as ResultRow[]) {
    const arr = map.get(row.vote_id) ?? [];
    arr.push(row);
    map.set(row.vote_id, arr);
  }
  return map;
}

async function fetchUnlocks(
  voteIds: string[],
  userId: string | null
): Promise<Set<string>> {
  if (voteIds.length === 0 || !userId) return new Set();
  const { data, error } = await supabase
    .from("vote_unlocks")
    .select("vote_id")
    .eq("user_id", userId)
    .in("vote_id", voteIds);
  if (error) throw error;
  return new Set((data ?? []).map((r: { vote_id: string }) => r.vote_id));
}

async function fetchMyCasts(
  voteIds: string[],
  userId: string | null
): Promise<Map<string, string>> {
  if (voteIds.length === 0 || !userId) return new Map();
  const { data, error } = await supabase
    .from("vote_casts")
    .select("vote_id, option_id")
    .eq("user_id", userId)
    .in("vote_id", voteIds);
  if (error) throw error;
  const map = new Map<string, string>();
  for (const row of (data ?? []) as CastRow[]) {
    map.set(row.vote_id, row.option_id);
  }
  return map;
}

function buildOptionsWithRatio(
  options: OptionRow[],
  results: ResultRow[],
  totalParticipants: number
): VoteOption[] {
  const byOptId = new Map<string, ResultRow>();
  for (const r of results) byOptId.set(r.option_id, r);
  return options.map((opt) => {
    const r = byOptId.get(opt.id);
    const count = r?.total_count ?? 0;
    const ratio =
      totalParticipants > 0 ? Math.round((count / totalParticipants) * 100) : 0;
    return { id: opt.id, label: opt.option_text, ratio };
  });
}

function deriveTag(
  participants: number,
  closed: boolean
): "popular" | "new" | "closed" {
  if (closed) return "closed";
  if (participants >= POPULAR_THRESHOLD) return "popular";
  return "new";
}

export async function fetchFeedVotes(
  category: CategoryKey
): Promise<FeedVote[]> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  let query = supabase
    .from("votes")
    .select(VOTE_COLS)
    .eq("type", "normal")
    .in("status", ["active", "closed"])
    .gte("closed_at", cutoff)
    .order("closed_at", { ascending: false })
    .limit(FEED_LIMIT);

  if (category !== "all") {
    query = query.eq("category", UI_TO_DB[category]);
  }

  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as VoteRow[];
  if (rows.length === 0) return [];

  const voteIds = rows.map((r) => r.id);
  const userId = await getCurrentUserId();
  const [optionsMap, resultsMap, myCasts] = await Promise.all([
    fetchVotesWithOptions(voteIds),
    fetchResults(voteIds),
    fetchMyCasts(voteIds, userId),
  ]);

  return rows.map((row) => {
    const options = optionsMap.get(row.id) ?? [];
    const results = resultsMap.get(row.id) ?? [];
    const closed = isClosedNow(row, now);
    // 클라이언트 캐시 overlay — 상세에서 투표 직후 홈 복귀 시 서버 갱신 전에도 결과 바 노출
    const hasMyCast = myCasts.has(row.id) || hasMyCachedCast(row.id);
    return {
      id: row.id,
      category: DB_TO_UI[row.category],
      tag: deriveTag(row.participants_count, closed),
      question: row.question,
      participants: row.participants_count,
      remainingLabel: formatRemainingLabel(new Date(row.closed_at), now),
      options: buildOptionsWithRatio(options, results, row.participants_count),
      // 미참여자에게는 마감이라도 결과 바 숨김 (광고 게이트 동기 유지)
      showResultBar: hasMyCast,
    };
  });
}

export async function fetchTodayVote(
  category: UiCategoryNoAll
): Promise<TodayVote | null> {
  if (category === "etc") return null;
  const now = new Date();
  const { data, error } = await supabase
    .from("votes")
    .select(VOTE_COLS)
    .eq("type", "today")
    .eq("category", UI_TO_DB[category])
    .eq("status", "active")
    .gt("closed_at", now.toISOString())
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as VoteRow;

  return {
    id: row.id,
    category: DB_TO_UI[row.category] as TodayVote["category"],
    question: row.question,
    participants: row.participants_count,
    remainingLabel: formatRemainingLabel(new Date(row.closed_at), now),
  };
}

export async function fetchPastTodayVotes(
  category: CategoryKey,
  limit = PAST_TODAY_LIMIT
): Promise<PastTodayVote[]> {
  if (category === "etc") return [];
  const now = new Date();

  let query = supabase
    .from("votes")
    .select(VOTE_COLS)
    .eq("type", "today")
    .lt("closed_at", now.toISOString())
    .not("today_published_date", "is", null)
    .order("today_published_date", { ascending: false })
    .limit(limit);

  if (category !== "all") {
    query = query.eq("category", UI_TO_DB[category]);
  }

  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as VoteRow[];
  if (rows.length === 0) return [];

  const userId = await getCurrentUserId();
  const unlocks = await fetchUnlocks(
    rows.map((r) => r.id),
    userId
  );

  return rows
    .filter((r) => DB_TO_UI[r.category] !== "etc")
    .map((row) => ({
      id: row.id,
      category: DB_TO_UI[row.category] as PastTodayVote["category"],
      question: row.question,
      participants: row.participants_count,
      endedAt: row.today_published_date ?? row.closed_at.slice(0, 10),
      unlocked: unlocks.has(row.id),
    }));
}

function buildDemographicBuckets(
  options: OptionRow[],
  results: ResultRow[]
): { byGender: DemographicBucket[]; byAge: DemographicBucket[] } {
  const byOptId = new Map<string, ResultRow>();
  for (const r of results) byOptId.set(r.option_id, r);

  function ratiosFor(
    pickCount: (r: ResultRow | undefined) => number
  ): { ratios: Record<string, number>; total: number } {
    const counts = options.map((o) => pickCount(byOptId.get(o.id)));
    const total = counts.reduce((s, n) => s + n, 0);
    const ratios: Record<string, number> = {};
    options.forEach((o, idx) => {
      ratios[o.id] = total > 0 ? Math.round((counts[idx] / total) * 100) : 0;
    });
    return { ratios, total };
  }

  const male = ratiosFor((r) => r?.male_count ?? 0);
  const female = ratiosFor((r) => r?.female_count ?? 0);
  const a20 = ratiosFor((r) => r?.age_20s ?? 0);
  const a30 = ratiosFor((r) => r?.age_30s ?? 0);
  const a40 = ratiosFor((r) => r?.age_40plus ?? 0);

  return {
    byGender: [
      { key: "male", label: "남성", optionRatios: male.ratios, participants: male.total },
      {
        key: "female",
        label: "여성",
        optionRatios: female.ratios,
        participants: female.total,
      },
    ],
    byAge: [
      { key: "20s", label: "20대", optionRatios: a20.ratios, participants: a20.total },
      { key: "30s", label: "30대", optionRatios: a30.ratios, participants: a30.total },
      {
        key: "40plus",
        label: "40대+",
        optionRatios: a40.ratios,
        participants: a40.total,
      },
    ],
  };
}

export type VoteDetailResult = {
  detail: VoteDetail;
  myOptionId: string | null;
  hasUnlock: boolean;
};

export async function fetchVoteDetail(id: string): Promise<VoteDetailResult | null> {
  const now = new Date();
  const { data, error } = await supabase
    .from("votes")
    .select(VOTE_COLS)
    .eq("id", id)
    .in("status", ["active", "closed"])
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as VoteRow;

  const userId = await getCurrentUserId();
  const [optionsMap, resultsMap, myCasts, unlocks] = await Promise.all([
    fetchVotesWithOptions([row.id]),
    fetchResults([row.id]),
    fetchMyCasts([row.id], userId),
    fetchUnlocks([row.id], userId),
  ]);

  const options = optionsMap.get(row.id) ?? [];
  const results = resultsMap.get(row.id) ?? [];
  // 캐시 overlay — 서버 vote_casts 반영 전에도 내 선택 즉시 반영
  const myOptionId = myCasts.get(row.id) ?? getMyCachedCast(row.id);
  const closed = isClosedNow(row, now);

  const { byGender, byAge } = buildDemographicBuckets(options, results);

  return {
    detail: {
      id: row.id,
      category: DB_TO_UI[row.category],
      question: row.question,
      participants: row.participants_count,
      remainingLabel: formatRemainingLabel(new Date(row.closed_at), now),
      isClosed: closed,
      options: buildOptionsWithRatio(options, results, row.participants_count),
      byGender,
      byAge,
    },
    myOptionId,
    hasUnlock: unlocks.has(row.id),
  };
}

// ============================================================================
// 광고 시청 토큰 (백로그 §S2)
// ============================================================================

export type AdUnit =
  | "register_3plus"
  | "unlock_vote_result"
  | "mypage_free_pass"
  | "general";

export type AdTokenOutcome =
  | { ok: true; adToken: string }
  | { ok: false; reason: "auth" | "cap_reached" | "unknown"; message: string };

// 클라이언트 광고 시청 후 호출 — Edge Function이 토큰 발급, 5분 유효
export async function registerAdWatch(
  adUnit: AdUnit,
  sdkPayload?: unknown
): Promise<AdTokenOutcome> {
  const { data, error } = await supabase.functions.invoke("register-ad-watch", {
    body: { ad_unit: adUnit, sdk_payload: sdkPayload ?? null },
  });
  if (error) {
    return {
      ok: false,
      reason: "unknown",
      message: error.message ?? "광고 시청 등록에 실패했어요",
    };
  }
  const r = data as {
    ok?: boolean;
    error?: string;
    code?: string;
    ad_token?: string;
  };
  if (r?.ok !== true || !r.ad_token) {
    if (r?.code === "cap_reached") {
      return {
        ok: false,
        reason: "cap_reached",
        message: r.error ?? "오늘 광고 시청 한도에 도달했어요",
      };
    }
    return {
      ok: false,
      reason: "unknown",
      message: r?.error ?? "광고 시청 등록에 실패했어요",
    };
  }
  return { ok: true, adToken: r.ad_token };
}

export type UnlockOutcome =
  | { ok: true }
  | {
      ok: false;
      reason: "free_pass_unavailable" | "invalid_ad_token" | "auth" | "unknown";
      message: string;
    };

export async function unlockVoteResults(
  voteId: string,
  options: { adToken?: string; useFreePass?: boolean } = {}
): Promise<UnlockOutcome> {
  const { adToken, useFreePass = false } = options;
  const { error } = await supabase.rpc("unlock_vote_results", {
    p_vote_id: voteId,
    p_ad_token: adToken ?? null,
    p_use_free_pass: useFreePass,
  });
  if (!error) return { ok: true };

  if (error.code === "P0006") {
    return {
      ok: false,
      reason: "free_pass_unavailable",
      message: "무료이용권이 부족해요",
    };
  }
  if (error.code === "P0007") {
    return {
      ok: false,
      reason: "invalid_ad_token",
      message: "광고 시청이 만료됐어요. 다시 시도해주세요",
    };
  }
  if (error.code === "28000") {
    return { ok: false, reason: "auth", message: "로그인 정보가 없어요" };
  }
  return {
    ok: false,
    reason: "unknown",
    message: error.message ?? "결과를 열지 못했어요",
  };
}

// 본인의 모든 vote_unlocks 조회 (UnlockProvider hydrate용)
// RLS vote_unlocks_self_select 정책이 자동으로 본인 row만 반환
export async function fetchAllUserUnlocks(): Promise<string[]> {
  const userId = await getCurrentUserId();
  if (!userId) return [];
  const { data, error } = await supabase
    .from("vote_unlocks")
    .select("vote_id")
    .eq("user_id", userId);
  if (error) throw error;
  return (data ?? []).map((r: { vote_id: string }) => r.vote_id);
}

export type CastVoteOutcome =
  | { ok: true }
  | { ok: false; reason: "already_voted" | "closed" | "auth" | "unknown"; message: string };

export async function castVote(
  voteId: string,
  optionId: string
): Promise<CastVoteOutcome> {
  const userId = await getCurrentUserId();
  if (!userId) {
    return { ok: false, reason: "auth", message: "로그인 정보가 없어요" };
  }

  const { error } = await supabase.from("vote_casts").insert({
    vote_id: voteId,
    option_id: optionId,
    user_id: userId,
  });
  if (!error) return { ok: true };

  // 23505: unique violation (이미 투표함)
  if (error.code === "23505") {
    return {
      ok: false,
      reason: "already_voted",
      message: "이미 참여한 투표예요",
    };
  }
  // P0001: BEFORE INSERT 가드 트리거 (마감/비활성)
  if (error.code === "P0001") {
    return { ok: false, reason: "closed", message: "마감된 투표예요" };
  }
  return {
    ok: false,
    reason: "unknown",
    message: error.message ?? "투표에 실패했어요",
  };
}

// ============================================================================
// 등록 (RegisterScreen)
// ============================================================================

export type RegisterStatus = {
  normalCountToday: number;
  todayCandidateCountToday: number;
  nextNormalRequiresAd: boolean;
  normalCapReached: boolean;
  todayCandidateCapReached: boolean;
  registerBlocked: boolean;
};

export async function getRegisterStatus(): Promise<RegisterStatus> {
  const { data, error } = await supabase.rpc("get_register_status");
  if (error) throw error;
  // RPC는 setof record라 배열 반환. 단일 row.
  const row = (data ?? [])[0] as
    | {
        normal_count_today: number;
        today_candidate_count_today: number;
        next_normal_requires_ad: boolean;
        normal_cap_reached: boolean;
        today_candidate_cap_reached: boolean;
        register_blocked: boolean;
      }
    | undefined;
  if (!row) {
    return {
      normalCountToday: 0,
      todayCandidateCountToday: 0,
      nextNormalRequiresAd: false,
      normalCapReached: false,
      todayCandidateCapReached: false,
      registerBlocked: false,
    };
  }
  return {
    normalCountToday: row.normal_count_today,
    todayCandidateCountToday: row.today_candidate_count_today,
    nextNormalRequiresAd: row.next_normal_requires_ad,
    normalCapReached: row.normal_cap_reached,
    todayCandidateCapReached: row.today_candidate_cap_reached,
    registerBlocked: row.register_blocked,
  };
}

export type RegisterOutcome =
  | { ok: true; voteId: string }
  | {
      ok: false;
      reason:
        | "auth"
        | "validation"
        | "cap_reached"
        | "blocked"
        | "ad_required"
        | "ad_token_invalid"
        | "free_pass_unavailable"
        | "unknown";
      message: string;
    };

export type RegisterInput = {
  question: string;
  options: string[];
  category: UiCategoryNoAll;
  durationMinutes: 5 | 10 | 30 | 60;
  todayCandidate: boolean;
  adUsed?: boolean;
  useFreePass?: boolean;
  adToken?: string;
};

export async function registerVote(input: RegisterInput): Promise<RegisterOutcome> {
  const { data, error } = await supabase.rpc("register_vote", {
    p_question: input.question,
    p_options: input.options,
    p_category: UI_TO_DB[input.category],
    p_duration_minutes: input.durationMinutes,
    p_type: input.todayCandidate ? "today_candidate" : "normal",
    p_ad_used: input.adUsed ?? false,
    p_use_free_pass: input.useFreePass ?? false,
    p_ad_token: input.adToken ?? null,
  });

  if (!error) {
    const voteId = typeof data === "string" ? data : "";
    return { ok: true, voteId };
  }

  if (error.code === "28000") {
    return { ok: false, reason: "auth", message: "로그인 정보가 없어요" };
  }
  if (error.code === "23514") {
    return {
      ok: false,
      reason: "validation",
      message: "입력값을 확인해주세요",
    };
  }
  if (error.code === "P0002") {
    return {
      ok: false,
      reason: "cap_reached",
      message: input.todayCandidate
        ? "오늘의 투표 후보는 하루 1건만 신청할 수 있어요"
        : "오늘 등록 한도(10건)에 도달했어요",
    };
  }
  if (error.code === "P0003") {
    return {
      ok: false,
      reason: "blocked",
      message: "현재 등록이 일시 정지된 상태예요",
    };
  }
  if (error.code === "P0004") {
    return {
      ok: false,
      reason: "ad_required",
      message: "광고 시청 또는 무료이용권 사용이 필요해요",
    };
  }
  if (error.code === "P0006") {
    return {
      ok: false,
      reason: "free_pass_unavailable",
      message: "무료이용권을 사용할 수 없어요",
    };
  }
  if (error.code === "P0007") {
    return {
      ok: false,
      reason: "ad_token_invalid",
      message: "광고 시청이 만료됐어요. 다시 시도해주세요",
    };
  }
  return {
    ok: false,
    reason: "unknown",
    message: error.message ?? "등록에 실패했어요",
  };
}

// ============================================================================
// Claude 검열 (등록 직후 호출)
// ============================================================================

export type ModerationResult =
  | {
      ok: true;
      approved: boolean;
      aiScore: number | null;
      rejectionReason: string | null;
      status: "active" | "blinded";
    }
  | { ok: false; message: string };

export async function moderateVote(voteId: string): Promise<ModerationResult> {
  // Edge Function 호출 (Supabase functions.invoke가 자동으로 JWT 부착)
  const { data, error } = await supabase.functions.invoke("moderate-vote", {
    body: { vote_id: voteId },
  });
  if (error) {
    return {
      ok: false,
      message: error.message ?? "검열 요청에 실패했어요",
    };
  }
  const r = data as {
    ok?: boolean;
    error?: string;
    approved?: boolean;
    ai_score?: number | null;
    rejection_reason?: string | null;
    status?: "active" | "blinded";
    already_moderated?: boolean;
  };
  if (r?.ok !== true) {
    return { ok: false, message: r?.error ?? "검열에 실패했어요" };
  }
  return {
    ok: true,
    approved: r.approved ?? r.status === "active",
    aiScore: r.ai_score ?? null,
    rejectionReason: r.rejection_reason ?? null,
    status: r.status ?? "active",
  };
}

// ============================================================================
// 일일 미션 + 무료이용권 (홈 위젯, 마이페이지 카드)
// ============================================================================

export type MissionProgress = {
  current: number;
  target: number;
  completed: boolean;
  rewardPoints: number;
};

export type DailyMissions = {
  normalVoteParticipation: MissionProgress;
  normalVoteRegister: MissionProgress;
  todayCandidateRegister: MissionProgress;
  freePassBalance: number;
  adClaimedToday: boolean;
};

type MissionRpcRow = {
  current: number;
  target: number;
  completed: boolean;
  reward_points: number;
};

type MissionsRpcResult = {
  normal_vote_participation: MissionRpcRow;
  normal_vote_register: MissionRpcRow;
  today_candidate_register: MissionRpcRow;
  free_pass_balance: number;
  ad_claimed_today: boolean;
};

function toMission(row: MissionRpcRow): MissionProgress {
  return {
    current: row.current,
    target: row.target,
    completed: row.completed,
    rewardPoints: row.reward_points,
  };
}

export async function getDailyMissions(): Promise<DailyMissions> {
  const { data, error } = await supabase.rpc("get_daily_missions");
  if (error) throw error;
  const r = data as MissionsRpcResult;
  return {
    normalVoteParticipation: toMission(r.normal_vote_participation),
    normalVoteRegister: toMission(r.normal_vote_register),
    todayCandidateRegister: toMission(r.today_candidate_register),
    freePassBalance: r.free_pass_balance,
    adClaimedToday: r.ad_claimed_today,
  };
}

export type ClaimAdFreePassOutcome =
  | { ok: true; newBalance: number }
  | {
      ok: false;
      reason: "auth" | "already_claimed" | "ad_token_invalid" | "unknown";
      message: string;
    };

export async function claimDailyAdFreePass(
  adToken: string
): Promise<ClaimAdFreePassOutcome> {
  const { data, error } = await supabase.rpc("claim_daily_ad_free_pass", {
    p_ad_token: adToken,
  });
  if (!error) {
    return { ok: true, newBalance: typeof data === "number" ? data : 0 };
  }
  if (error.code === "28000") {
    return { ok: false, reason: "auth", message: "로그인 정보가 없어요" };
  }
  if (error.code === "P0005") {
    return {
      ok: false,
      reason: "already_claimed",
      message: "오늘은 이미 광고를 시청해 받았어요. 내일 다시 받을 수 있어요",
    };
  }
  if (error.code === "P0007") {
    return {
      ok: false,
      reason: "ad_token_invalid",
      message: "광고 시청이 만료됐어요. 다시 시도해주세요",
    };
  }
  return {
    ok: false,
    reason: "unknown",
    message: error.message ?? "무료이용권 받기에 실패했어요",
  };
}
