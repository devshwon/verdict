// LLM 검열 Edge Function (백로그 §S1)
//
// 흐름:
//   1) 클라이언트가 register_vote RPC로 투표 등록 → status='pending_review' + vote_id 반환
//   2) 클라이언트가 이 함수에 vote_id 전달
//   3) 함수가 service_role로 vote + options 조회 + 최근 30일 같은 카테고리 sample 조회 (중복 검사)
//   4) **사전 휴리스틱**: 명백한 도배(짧은/반복 문자) → OpenAI 호출 없이 즉시 반려
//   5) **호출 캡 체크**: fn_check_moderation_call (user당 일일 20회 한도 — cost 안전망)
//   6) OpenAI Chat Completions 호출 (gpt-4o-mini + JSON 모드)
//   7) service_role로 votes UPDATE (status, ai_score, rejection_reason)
//   8) fn_record_moderation_result 호출 — approved 시 보상 적립, rejected 시 카운터 증가/연속3회 정지
//
// 환경변수 필요:
//   - OPENAI_API_KEY (Supabase secret)
//   - SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (Supabase 자동 주입)
//
// 비용 (1건당, sample 10개 기준):
//   - 입력 ~800 tokens, 출력 ~80 tokens
//   - gpt-4o-mini: ₩0.24 / 건 (입력 $0.15 / 출력 $0.60 per 1M tokens)
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

// 기획서 §10 — gpt-4o-mini로 검열 (한국어 분류 + JSON 출력에 충분, 비용 효율 최대)
const OPENAI_MODEL = 'gpt-4o-mini'
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
//   - 길이 부족 / 의미 없는 반복 문자 / 자기 동일 질문 도배 같은 명백한 케이스 컷
function preScreen(question: string, options: string[]): string | null {
  const q = question.trim()
  if (q.length < 4) return '질문이 너무 짧아요'

  // 같은 문자 반복 50% 초과 (예: "ㅋㅋㅋㅋㅋㅋㅋㅋ", "ㅁㄴㅇㄹㅁㄴㅇㄹ")
  const charCount = new Map<string, number>()
  for (const ch of q.replace(/\s/g, '')) {
    charCount.set(ch, (charCount.get(ch) ?? 0) + 1)
  }
  const total = [...charCount.values()].reduce((s, n) => s + n, 0)
  const maxCount = Math.max(...charCount.values())
  if (total >= 4 && maxCount / total > 0.6) {
    return '의미 없는 반복 문자가 포함돼 있어요'
  }

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

  const systemPrompt = `당신은 한국어 소셜 투표 앱 "Verdict"의 질문 검열관입니다.
사용자가 등록한 투표 질문/선택지를 다음 기준으로 평가하고 JSON으로만 응답하세요.

평가 기준:
1. 혐오/비하/정치적 편향 표현 → reject
2. 의미 없는 도배·테스트성 텍스트 → reject
3. 폭력·선정·범죄 미화 → reject
4. 최근 30일 내 매우 유사한 질문이 있으면 → reject (사유에 "유사 질문 존재" 명시)
5. 통과 시 흥미도 0.0~10.0 점수 산출 (대중 의견이 갈릴수록 ↑, 정답 있는 질문일수록 ↓)

응답 형식 (반드시 이 JSON 스키마만):
{
  "approved": true|false,
  "ai_score": 0.0~10.0 (approved=true일 때만, false면 null),
  "rejection_reason": "한 문장 사유" (approved=false일 때만, true면 null)
}`

  const recentSection = recentSample.length > 0
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
      max_tokens: 256,
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
  }

  if (typeof parsed.approved !== 'boolean') {
    throw new Error('OpenAI response missing "approved" field')
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

    // ── LLM 검열 (OpenAI gpt-4o-mini) ──────────────────────────
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
