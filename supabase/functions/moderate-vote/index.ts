// LLM 검열 Edge Function (백로그 §S1)
//
// 흐름:
//   1) 클라이언트가 register_vote RPC로 투표 등록 → status='pending_review' + vote_id 반환
//   2) 클라이언트가 이 함수에 vote_id 전달
//   3) 함수가 service_role로 vote + options 조회 + 최근 30일 같은 카테고리 sample 조회 (중복 검사)
//   4) OpenAI Chat Completions 호출 (gpt-4o-mini + JSON 모드)
//   5) service_role로 votes UPDATE (status, ai_score, rejection_reason)
//   6) 반려 시 등록 시점 적립된 보상 회수 (§S8)
//   7) 클라이언트에 결과 반환
//
// 환경변수 필요:
//   - OPENAI_API_KEY (Supabase secret)
//   - SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (Supabase 자동 주입)
//
// 비용 (1건당, sample 10개 기준):
//   - 입력 ~800 tokens, 출력 ~80 tokens
//   - gpt-4o-mini: ₩0.24 / 건 (입력 $0.15 / 출력 $0.60 per 1M tokens)

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? ''

// 기획서 §10 — gpt-4o-mini로 검열 (한국어 분류 + JSON 출력에 충분, 비용 효율 최대)
// 정확도 이슈 발생 시 'gpt-4o' 또는 다른 모델로 교체
const OPENAI_MODEL = 'gpt-4o-mini'
const SIMILARITY_SAMPLE_LIMIT = 10

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
  type: string
  status: string
}

interface OptionRow {
  option_text: string
  display_order: number
}

async function callOpenAI(
  question: string,
  options: string[],
  category: string,
  recentSample: string[],
): Promise<ModerationResult> {
  if (!OPENAI_API_KEY) {
    // 키 미설정 시 fallback: 통과 처리 + ai_score 5.0 (운영 시작 전 안전장치)
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
      // JSON 모드 강제 — 응답이 항상 valid JSON 단일 객체로 보장
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

  // JSON 모드 강제이므로 직접 파싱 (markdown 블록 추출 불필요)
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
    // 1) vote 조회 + status 검증 (이미 검열 끝난 vote는 재검열 안 함)
    const { data: voteRow, error: voteErr } = await admin
      .from('votes')
      .select('id, author_id, question, category, type, status')
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

    // 2) options 조회
    const { data: optionRows, error: optErr } = await admin
      .from('vote_options')
      .select('option_text, display_order')
      .eq('vote_id', voteId)
      .order('display_order', { ascending: true })
    if (optErr) throw optErr
    const options = ((optionRows ?? []) as OptionRow[]).map((o) => o.option_text)

    // 3) 최근 30일 동일 카테고리 sample 조회 (유사도 비교용)
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

    // 4) LLM 검열 (OpenAI gpt-4o-mini)
    const result = await callOpenAI(vote.question, options, vote.category, recentSample)

    // 5) votes UPDATE
    const newStatus = result.approved ? 'active' : 'blinded'
    const { error: updErr } = await admin
      .from('votes')
      .update({
        status: newStatus,
        ai_score: result.ai_score,
        rejection_reason: result.rejection_reason,
      })
      .eq('id', voteId)
      .eq('status', 'pending_review')   // race 방어
    if (updErr) throw updErr

    // 6) 반려 시 등록 시점 적립된 보상 회수 (백로그 §S8)
    //    pending 상태인 normal_vote_register / today_candidate_register만 차단
    //    이미 토스 지급 완료(completed)된 row는 건드리지 않음 — 정책상 회수 불가
    if (!result.approved) {
      const { error: blockErr } = await admin
        .from('points_log')
        .update({ status: 'blocked' })
        .eq('related_vote_id', voteId)
        .eq('status', 'pending')
        .in('trigger', ['normal_vote_register', 'today_candidate_register'])
      if (blockErr) {
        console.error('[moderate-vote] points block failed:', blockErr.message)
        // 보상 회수 실패는 검열 결과 반환을 막지 않음 (운영자 수동 회수 가능)
      }
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
