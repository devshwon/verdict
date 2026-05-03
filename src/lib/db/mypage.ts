import { supabase } from "../../config/supabase";
import type { CategoryKey } from "../../design/tokens";
import type { MyVote, ParticipatedVote } from "../../features/mypage/types";

type DbCategory = "daily" | "relationship" | "work" | "game" | "etc";
type UiCategoryNoAll = Exclude<CategoryKey, "all">;

const DB_TO_UI: Record<DbCategory, UiCategoryNoAll> = {
  daily: "daily",
  relationship: "love",
  work: "work",
  game: "game",
  etc: "etc",
};

const MY_VOTE_LIMIT = 30;
const PARTICIPATED_LIMIT = 30;
// 일반 투표 마이페이지 노출은 최근 30일치만 (기획서 §4-4 / §12-1)
const PARTICIPATED_DAYS = 30;

export type MyPageProfile = {
  userId: string;
  nickname: string;
  tossVerified: boolean;
};

export type MyPageDemographics = {
  gender: "M" | "F" | "undisclosed";
  ageBucket: "age_20s" | "age_30s" | "age_40plus" | "undisclosed";
  genderPublic: boolean;
  agePublic: boolean;
};

export type MyPageStats = {
  created: number;
  participated: number;
  featured: number;
};

export type MyPageData = {
  profile: MyPageProfile;
  demographics: MyPageDemographics;
  stats: MyPageStats;
  myVotes: MyVote[];
  participatedVotes: ParticipatedVote[];
};

// 닉네임 deterministic 생성: user.id의 hex 일부 추출 (DB 미저장 — §4-4)
export function nicknameFromUserId(userId: string): string {
  const hex = userId.replace(/-/g, "").toUpperCase().slice(0, 4);
  return `판정단 #${hex}`;
}

type UserRow = {
  id: string;
  gender: "M" | "F" | "undisclosed";
  age_bucket: "age_20s" | "age_30s" | "age_40plus" | "undisclosed";
  gender_public: boolean;
  age_public: boolean;
};

type AuthoredVoteRow = {
  id: string;
  category: DbCategory;
  question: string;
  status: "pending_review" | "active" | "closed" | "blinded" | "deleted";
  type: "normal" | "today" | "today_candidate";
  closed_at: string;
  participants_count: number;
  today_published_date: string | null;
  rejection_reason: string | null;
};

type ParticipatedJoinRow = {
  vote_id: string;
  option_id: string;
  cast_at: string;
};

type VoteWithOptionsRow = {
  id: string;
  category: DbCategory;
  question: string;
  type: "normal" | "today" | "today_candidate";
  status: "pending_review" | "active" | "closed" | "blinded" | "deleted";
  closed_at: string;
  participants_count: number;
  vote_options: { id: string; option_text: string; display_order: number }[];
};

type ResultRow = {
  vote_id: string;
  option_id: string;
  total_count: number;
};

function formatRemainingLabel(closedAt: Date, now: Date): string {
  const diffMs = closedAt.getTime() - now.getTime();
  if (diffMs <= 0) return "마감";
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 60) return `${diffMin}분 남음`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}시간 남음`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}일 남음`;
}

export async function fetchMyPageData(): Promise<MyPageData | null> {
  const { data: authData } = await supabase.auth.getUser();
  const user = authData.user;
  if (!user) return null;

  const userId = user.id;
  const now = new Date();
  const cutoff30d = new Date(
    now.getTime() - PARTICIPATED_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  // 1) demographics
  const { data: userRow, error: userErr } = await supabase
    .from("users")
    .select("id, gender, age_bucket, gender_public, age_public")
    .eq("id", userId)
    .single();
  if (userErr) throw userErr;
  const u = userRow as UserRow;

  // 2) 내가 올린 투표 (normal + today + today_candidate, 최근 30일치)
  //    — today_candidate 는 미선정 후보 노출 (§4-4)
  const { data: authoredRows, error: authoredErr } = await supabase
    .from("votes")
    .select(
      "id, category, question, status, type, closed_at, participants_count, today_published_date, rejection_reason, created_at"
    )
    .eq("author_id", userId)
    .gte("created_at", cutoff30d)
    .order("created_at", { ascending: false })
    .limit(MY_VOTE_LIMIT);
  if (authoredErr) throw authoredErr;
  const authored = (authoredRows ?? []) as (AuthoredVoteRow & { created_at: string })[];

  const myVotes: MyVote[] = authored
    .filter((r) => DB_TO_UI[r.category] !== undefined)
    .map((r) => {
      const closed = r.status === "closed" || new Date(r.closed_at) <= now;
      let myStatus: MyVote["status"];
      if (r.status === "pending_review") myStatus = "pending_review";
      else if (r.status === "blinded") myStatus = "blinded";
      else if (closed) myStatus = "closed";
      else myStatus = "ongoing";
      return {
        id: r.id,
        category: DB_TO_UI[r.category],
        question: r.question,
        participants: r.participants_count,
        status: myStatus,
        remainingLabel:
          myStatus === "ongoing"
            ? formatRemainingLabel(new Date(r.closed_at), now)
            : undefined,
        rejectionReason: r.rejection_reason,
      };
    });

  // 3) 참여한 투표 (vote_casts → votes 조인)
  const { data: castRows, error: castErr } = await supabase
    .from("vote_casts")
    .select("vote_id, option_id, cast_at")
    .eq("user_id", userId)
    .gte("cast_at", cutoff30d)
    .order("cast_at", { ascending: false })
    .limit(PARTICIPATED_LIMIT);
  if (castErr) throw castErr;
  const casts = (castRows ?? []) as ParticipatedJoinRow[];

  let participatedVotes: ParticipatedVote[] = [];
  if (casts.length > 0) {
    const voteIds = casts.map((c) => c.vote_id);
    const [{ data: voteRows, error: voteErr }, { data: resultRows, error: resErr }] =
      await Promise.all([
        supabase
          .from("votes")
          .select(
            "id, category, question, type, status, closed_at, participants_count, vote_options(id, option_text, display_order)"
          )
          .in("id", voteIds),
        supabase.rpc("get_vote_results", { p_vote_ids: voteIds }),
      ]);
    if (voteErr) throw voteErr;
    if (resErr) throw resErr;

    const voteById = new Map<string, VoteWithOptionsRow>();
    for (const v of (voteRows ?? []) as VoteWithOptionsRow[]) {
      voteById.set(v.id, v);
    }

    // 결과 → vote_id별 옵션별 카운트 매핑
    const countsByVote = new Map<string, Map<string, number>>();
    for (const r of (resultRows ?? []) as ResultRow[]) {
      const m = countsByVote.get(r.vote_id) ?? new Map<string, number>();
      m.set(r.option_id, r.total_count);
      countsByVote.set(r.vote_id, m);
    }

    participatedVotes = casts
      .map((c) => {
        const v = voteById.get(c.vote_id);
        if (!v) return null;
        const ui = DB_TO_UI[v.category];
        if (ui === undefined) return null;

        const options = [...v.vote_options].sort(
          (a, b) => a.display_order - b.display_order
        );
        const myOpt = options.find((o) => o.id === c.option_id);

        // 다수의견 — 최대 카운트 옵션
        const counts = countsByVote.get(v.id);
        let majorityOpt: typeof options[number] | undefined;
        let majorityCount = -1;
        if (counts) {
          for (const opt of options) {
            const cnt = counts.get(opt.id) ?? 0;
            if (cnt > majorityCount) {
              majorityCount = cnt;
              majorityOpt = opt;
            }
          }
        }

        const matched =
          myOpt !== undefined &&
          majorityOpt !== undefined &&
          myOpt.id === majorityOpt.id;

        return {
          id: v.id,
          category: ui,
          question: v.question,
          participants: v.participants_count,
          myChoice: myOpt?.option_text ?? "",
          majorityChoice: majorityOpt?.option_text ?? "—",
          matched,
        } as ParticipatedVote;
      })
      .filter((v): v is ParticipatedVote => v !== null);
  }

  // 4) stats — 내가 올린 / 참여한 / 상단 선정 (today 발행)
  // created: 마이페이지 노출 기간(30일)과 무관하게 전체 카운트
  const [
    { count: createdCount },
    { count: participatedCount },
    { count: featuredCount },
  ] = await Promise.all([
    supabase
      .from("votes")
      .select("id", { count: "exact", head: true })
      .eq("author_id", userId)
      .in("type", ["normal", "today", "today_candidate"]),
    supabase
      .from("vote_casts")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId),
    supabase
      .from("votes")
      .select("id", { count: "exact", head: true })
      .eq("author_id", userId)
      .eq("type", "today")
      .not("today_published_date", "is", null),
  ]);

  return {
    profile: {
      userId,
      nickname: nicknameFromUserId(userId),
      tossVerified: true,
    },
    demographics: {
      gender: u.gender,
      ageBucket: u.age_bucket,
      genderPublic: u.gender_public,
      agePublic: u.age_public,
    },
    stats: {
      created: createdCount ?? 0,
      participated: participatedCount ?? 0,
      featured: featuredCount ?? 0,
    },
    myVotes,
    participatedVotes,
  };
}

export async function updateDemographicsVisibility(
  next: { genderPublic?: boolean; agePublic?: boolean }
): Promise<void> {
  // *_public 플래그만 RPC로 전달. effective gender/age_bucket은
  // DB 트리거(fn_users_sync_effective_demographics)가 raw + flag로 자동 재계산
  // → 토글 OFF 후 다시 ON 해도 raw 값이 보존되어 즉시 복원됨
  const { error } = await supabase.rpc("update_demographics_visibility", {
    p_gender_public: next.genderPublic ?? null,
    p_age_public: next.agePublic ?? null,
  });
  if (error) throw error;
}
