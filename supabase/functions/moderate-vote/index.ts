// LLM 검열 Edge Function (백로그 §S1)
//
// 흐름:
//   1) 클라이언트가 register_vote RPC로 투표 등록 → status='pending_review' + vote_id 반환
//   2) 클라이언트가 이 함수에 vote_id 전달
//   3) 함수가 service_role로 vote + options 조회 + 최근 30일 같은 카테고리 sample 조회 (중복 검사)
//   4) **사전 휴리스틱**: 명백한 도배(짧은/반복 문자) → OpenAI 호출 없이 즉시 반려
//   5) **호출 캡 체크**: fn_check_moderation_call (user당 일일 20회 한도 — cost 안전망)
//   6) OpenAI Chat Completions 호출 (gpt-5.4-nano + JSON 모드)
//   7) service_role로 votes UPDATE (status, ai_score, rejection_reason)
//   8) fn_record_moderation_result 호출 — approved 시 보상 적립, rejected 시 카운터 증가/연속3회 정지
//
// 환경변수 필요:
//   - OPENAI_API_KEY (Supabase secret)
//   - SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (Supabase 자동 주입)
//
// 비용 (1건당, sample 10개 기준):
//   - 입력 ~800 tokens, 출력 ~80 tokens
//   - 모델 단가에 따라 산정 — gpt-5.4-nano 단가로 재산정 필요
//
// 어뷰징 방어 다중 레이어:
//   - register_vote RPC: 일일 반려 5회 도달 시 P0008로 등록 자체 차단 (OpenAI 호출 안 됨)
//   - register_vote RPC: 연속 반려 3회 시 1시간 등록 정지
//   - 본 함수: 사전 휴리스틱(저비용 1차 필터) + 일일 검열 호출 캡(20회 하드 천장)
//   - 보상 적립은 검열 통과 시점에만 발생 → 반려 어뷰징 동기 제거

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? ''

// 모더레이션 모드 — 기본값은 사후 모더레이션(LLM 차단 없음)
//   - 'heuristic_only': 사전 휴리스틱만 적용. 통과 시 즉시 active. LLM 호출 안 함.
//   - 'with_llm': 기존 흐름. 휴리스틱 + LLM 검열로 차단.
const MODERATION_MODE = (Deno.env.get('MODERATION_MODE') ?? 'heuristic_only').toLowerCase()

// 기획서 §10 — gpt-5.4-nano로 검열 (한국어 분류 + JSON 출력에 충분, 비용 효율 최대)
const OPENAI_MODEL = 'gpt-5.4-nano'
const SIMILARITY_SAMPLE_LIMIT = 10
const DAILY_MODERATION_CALL_CAP = 20

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Max-Age': '86400',
}

function withCors(res: Response): Response {
  const headers = new Headers(res.headers)
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
  return new Response(res.body, { status: res.status, headers })
}

interface ModerationResult {
  approved: boolean
  ai_score: number | null
  rejection_reason: string | null
}

interface VoteRow {
  id: string
  author_id: string
  question: string
  category: string
  type: 'normal' | 'today_candidate' | 'today'
  status: string
  created_at: string
}

interface OptionRow {
  option_text: string
  display_order: number
}

// 사전 휴리스틱 (OpenAI 호출 전 1차 필터, 비용 0)
//   - 클라이언트 폼이 동일 검증을 먼저 수행하지만, RPC 직접 호출 등을 막는 안전망으로 유지
//   - 정책: 4자 미만 질문, 선택지 중복만 컷. 반복문자/패턴은 정상 질문도 막을 수 있어 사후 모더레이션(신고)에 위임
function preScreen(question: string, options: string[]): string | null {
  const q = question.trim()
  if (q.length < 4) return '질문은 4자 이상 입력해주세요'

  // 선택지 중복
  const opts = options.map((o) => o.trim().toLowerCase())
  if (new Set(opts).size !== opts.length) {
    return '선택지에 중복이 있어요'
  }
  return null
}

async function callOpenAI(
  question: string,
  options: string[],
  category: string,
  recentSample: string[],
): Promise<ModerationResult> {
  if (!OPENAI_API_KEY) {
    console.warn('[moderate-vote] OPENAI_API_KEY not set, falling back to approve')
    return { approved: true, ai_score: 5.0, rejection_reason: null }
  }

  const hasSample = recentSample.length > 0

  // 평가기준 4(유사도)는 샘플이 있을 때만 노출. 샘플이 없으면 환각으로 "유사" 판정 방지
  const similarityRule = hasSample
    ? `4. 아래 샘플 중 "사실상 같은 질문"이 있으면 → reject
   - 사실상 같다 = 주제·답안 구조·의도가 거의 동일 (표현·어투·길이 차이는 무관)
   - 카테고리만 같고 주제 영역이 다르면 유사 아님
     예) "어떤 카드가 좋아?" vs "첫만남 더치페이?" → 둘 다 daily여도 주제(결제수단 vs 데이팅 매너)가 달라 유사 아님
   - 유사 reject는 반드시 similar_to_index 에 일치 샘플 번호(1-base) 명시. 못 대면 유사 reject 금지`
    : ''

  const systemPrompt = `당신은 한국어 소셜 투표 앱 "Verdict"의 질문 검열관입니다.
사용자가 등록한 투표 질문/선택지를 다음 기준으로 평가하고 JSON으로만 응답하세요.

평가 기준:
1. 혐오/비하/정치적 편향 표현 → reject
2. 의미 없는 도배·테스트성 텍스트 → reject
3. 폭력·선정·범죄 미화 → reject${similarityRule ? '\n' + similarityRule : ''}
${hasSample ? '5' : '4'}. 통과 시 흥미도 0.0~10.0 점수 산출 (대중 의견이 갈릴수록 ↑, 정답 있는 질문일수록 ↓)

rejection_reason 작성 규칙:
- 자연스러운 한 문장. 정해진 라벨 문구를 강제로 끼워 넣지 마세요.
- 유사 사유라도 "유사 질문 존재" 같은 라벨이 아니라 어떤 점이 같은지 한 문장으로.

응답 형식 (반드시 이 JSON 스키마만):
{
  "approved": true|false,
  "ai_score": 0.0~10.0 (approved=true일 때만, false면 null),
  "rejection_reason": "한 문장 사유" (approved=false일 때만, true면 null),
  "similar_to_index": 1~N 정수 (유사 사유로 reject할 때만, 그 외 null)
}`

  const recentSection = hasSample
    ? `\n\n최근 30일 같은 카테고리 질문 샘플 (유사도 비교용):\n${recentSample.map((q, i) => `${i + 1}. ${q}`).join('\n')}`
    : ''

  const userPrompt = `카테고리: ${category}
질문: ${question}
선택지: ${options.join(' / ')}${recentSection}`

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      max_completion_tokens: 256,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`OpenAI API error ${response.status}: ${errText.slice(0, 300)}`)
  }

  const data = await response.json() as {
    choices?: { message?: { content?: string } }[]
  }
  const text = data.choices?.[0]?.message?.content ?? ''
  if (!text) {
    throw new Error('OpenAI response empty')
  }

  const parsed = JSON.parse(text) as {
    approved?: boolean
    ai_score?: number | null
    rejection_reason?: string | null
    similar_to_index?: number | null
  }

  if (typeof parsed.approved !== 'boolean') {
    throw new Error('OpenAI response missing "approved" field')
  }

  // 유사 사유 reject 가드: 샘플 인덱스를 못 대면 검열 통과로 전환 (false positive 방지)
  if (parsed.approved === false) {
    const reason = (parsed.rejection_reason ?? '').trim()
    const looksLikeSimilarity = /유사|중복|이미|already|similar|duplicate/i.test(reason)
    const idx = parsed.similar_to_index
    const validIdx = typeof idx === 'number' && Number.isInteger(idx) && idx >= 1 && idx <= recentSample.length

    if (looksLikeSimilarity && !validIdx) {
      console.warn(
        `[moderate-vote] similarity reject without valid index — overriding to approve. reason="${reason}" idx=${idx}`,
      )
      return { approved: true, ai_score: 5.0, rejection_reason: null }
    }
  }

  return {
    approved: parsed.approved,
    ai_score: parsed.approved ? clampScore(parsed.ai_score) : null,
    rejection_reason: parsed.approved ? null : (parsed.rejection_reason ?? '검열 기준 미충족'),
  }
}

function clampScore(s: unknown): number | null {
  if (typeof s !== 'number' || !isFinite(s)) return null
  return Math.max(0, Math.min(10, s))
}

// 등록 시점에 1~2건째였는지 판정 — 보상 eligibility 결정
//   normal: 같은 user의 같은 KST 자정 이후 normal vote 중 created_at < this의 row 개수 < 2
//   today_candidate: 같은 user의 같은 KST 자정 이후 today_candidate 중 created_at < this의 row 개수 < 1 (= 첫 건)
async function deriveRewardEligibility(
  admin: ReturnType<typeof createClient>,
  vote: VoteRow,
): Promise<boolean> {
  if (vote.type !== 'normal' && vote.type !== 'today_candidate') return false

  const created = new Date(vote.created_at)
  // KST 자정 ISO
  const kstMidnight = new Date(
    new Date(created.toLocaleString('en-US', { timeZone: 'Asia/Seoul' })).setHours(0, 0, 0, 0),
  ).toISOString()

  const { count, error } = await admin
    .from('votes')
    .select('id', { count: 'exact', head: true })
    .eq('author_id', vote.author_id)
    .eq('type', vote.type)
    .neq('id', vote.id)
    .gte('created_at', kstMidnight)
    .lt('created_at', vote.created_at)
  if (error) throw error

  if (vote.type === 'normal') return (count ?? 0) < 2
  return (count ?? 0) < 1
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') {
    return withCors(new Response('Method Not Allowed', { status: 405 }))
  }

  let voteId: string
  try {
    const body = await req.json()
    if (typeof body?.vote_id !== 'string' || body.vote_id.length === 0) {
      return withCors(new Response('Bad Request: vote_id required', { status: 400 }))
    }
    voteId = body.vote_id
  } catch {
    return withCors(new Response('Bad Request: invalid JSON', { status: 400 }))
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  try {
    const { data: voteRow, error: voteErr } = await admin
      .from('votes')
      .select('id, author_id, question, category, type, status, created_at')
      .eq('id', voteId)
      .single()
    if (voteErr) throw voteErr
    const vote = voteRow as VoteRow

    if (vote.status !== 'pending_review') {
      return withCors(Response.json({
        ok: true,
        already_moderated: true,
        status: vote.status,
      }))
    }

    const { data: optionRows, error: optErr } = await admin
      .from('vote_options')
      .select('option_text, display_order')
      .eq('vote_id', voteId)
      .order('display_order', { ascending: true })
    if (optErr) throw optErr
    const options = ((optionRows ?? []) as OptionRow[]).map((o) => o.option_text)

    // ── 사전 휴리스틱 (저비용 1차 필터) ─────────────────────────
    const preScreenReason = preScreen(vote.question, options)
    if (preScreenReason !== null) {
      const eligible = await deriveRewardEligibility(admin, vote)
      const { error: updErr } = await admin
        .from('votes')
        .update({
          status: 'blinded',
          ai_score: null,
          rejection_reason: preScreenReason,
        })
        .eq('id', voteId)
        .eq('status', 'pending_review')
      if (updErr) throw updErr

      const { error: recErr } = await admin.rpc('fn_record_moderation_result', {
        p_vote_id: voteId,
        p_user_id: vote.author_id,
        p_vote_type: vote.type,
        p_eligible_for_register_reward: eligible,
        p_approved: false,
        p_rejection_source: 'prescreen',
      })
      if (recErr) console.error('[moderate-vote] record (pre-screen) failed:', recErr.message)

      return withCors(Response.json({
        ok: true,
        approved: false,
        ai_score: null,
        rejection_reason: preScreenReason,
        status: 'blinded',
      }))
    }

    // ── 사후 모더레이션 모드 (기본): LLM 호출 없이 즉시 active 전환 ──
    if (MODERATION_MODE === 'heuristic_only') {
      const eligible = await deriveRewardEligibility(admin, vote)

      const { error: updErr } = await admin
        .from('votes')
        .update({
          status: 'active',
          ai_score: null,
          rejection_reason: null,
        })
        .eq('id', voteId)
        .eq('status', 'pending_review')
      if (updErr) throw updErr

      // approved=true 로 기록 → 등록 보상 정상 적립
      const { error: recErr } = await admin.rpc('fn_record_moderation_result', {
        p_vote_id: voteId,
        p_user_id: vote.author_id,
        p_vote_type: vote.type,
        p_eligible_for_register_reward: eligible,
        p_approved: true,
        p_rejection_source: null,
      })
      if (recErr) console.error('[moderate-vote] record (heuristic_only) failed:', recErr.message)

      return withCors(Response.json({
        ok: true,
        approved: true,
        ai_score: null,
        rejection_reason: null,
        status: 'active',
      }))
    }

    // ── 이하 with_llm 모드 ──
    // ── 일일 검열 호출 캡 체크 (cost 안전망) ───────────────────
    const { data: callOk, error: callErr } = await admin.rpc('fn_check_moderation_call', {
      p_user_id: vote.author_id,
      p_daily_cap: DAILY_MODERATION_CALL_CAP,
    })
    if (callErr) throw callErr
    if (callOk !== true) {
      // 호출 캡 도달 → OpenAI 호출 없이 자동 반려
      const { error: updErr } = await admin
        .from('votes')
        .update({
          status: 'blinded',
          rejection_reason: '오늘 검열 한도를 초과했어요. 내일 다시 시도해주세요',
        })
        .eq('id', voteId)
        .eq('status', 'pending_review')
      if (updErr) throw updErr

      // call_cap 시스템 한도라 카운터/정지/환급 모두 적용 안 함 (사용자 책임 아님)
      const { error: recErr } = await admin.rpc('fn_record_moderation_result', {
        p_vote_id: voteId,
        p_user_id: vote.author_id,
        p_vote_type: vote.type,
        p_eligible_for_register_reward: false,
        p_approved: false,
        p_rejection_source: 'call_cap',
      })
      if (recErr) console.error('[moderate-vote] record (call_cap) failed:', recErr.message)

      return withCors(Response.json({
        ok: true,
        approved: false,
        ai_score: null,
        rejection_reason: '오늘 검열 한도를 초과했어요. 내일 다시 시도해주세요',
        status: 'blinded',
      }))
    }

    // ── 최근 30일 동일 카테고리 sample 조회 ─────────────────────
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const { data: recentRows, error: recentErr } = await admin
      .from('votes')
      .select('question')
      .eq('category', vote.category)
      .eq('status', 'active')
      .gte('created_at', thirtyDaysAgo)
      .neq('id', voteId)
      .order('created_at', { ascending: false })
      .limit(SIMILARITY_SAMPLE_LIMIT)
    if (recentErr) throw recentErr
    const recentSample = ((recentRows ?? []) as { question: string }[]).map((r) => r.question)

    // ── LLM 검열 (OpenAI gpt-5.4-nano) ──────────────────────────
    const result = await callOpenAI(vote.question, options, vote.category, recentSample)

    // ── votes UPDATE ────────────────────────────────────────────
    const newStatus = result.approved ? 'active' : 'blinded'
    const { error: updErr } = await admin
      .from('votes')
      .update({
        status: newStatus,
        ai_score: result.ai_score,
        rejection_reason: result.rejection_reason,
      })
      .eq('id', voteId)
      .eq('status', 'pending_review')
    if (updErr) throw updErr

    // ── 결과 기록: approved 시 보상 적립 / rejected 시 카운터 증가 + 광고 보호 환급 ──
    const eligible = result.approved ? await deriveRewardEligibility(admin, vote) : false
    const { error: recErr } = await admin.rpc('fn_record_moderation_result', {
      p_vote_id: voteId,
      p_user_id: vote.author_id,
      p_vote_type: vote.type,
      p_eligible_for_register_reward: eligible,
      p_approved: result.approved,
      p_rejection_source: result.approved ? null : 'llm',
    })
    if (recErr) {
      console.error('[moderate-vote] record_moderation_result failed:', recErr.message)
      // 결과 기록 실패는 검열 결과 반환을 막지 않음 (운영자 수동 보정)
    }

    return withCors(Response.json({
      ok: true,
      approved: result.approved,
      ai_score: result.ai_score,
      rejection_reason: result.rejection_reason,
      status: newStatus,
    }))
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[moderate-vote] error:', msg)
    return withCors(Response.json({ ok: false, error: msg }, { status: 500 }))
  }
})
