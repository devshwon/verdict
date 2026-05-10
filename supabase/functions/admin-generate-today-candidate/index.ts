// Admin 오늘의 투표 후보 1건 자동 생성기 (DoD: docs/operations/admin-pre-launch-content-tools.md §4-3)
//
// 흐름:
//   1) Authorization 헤더의 user JWT로 users.is_admin 확인
//   2) admin_prompts에서 today_vote_gen_system / today_vote_gen_user 조회
//   3) {category} placeholder 치환
//   4) OpenAI Chat Completions (gpt-5.4-nano, JSON 모드) — 1건만 생성
//   5) 검증 (실패 시 1회 재시도) 후 미리보기 반환 — DB 저장은 SPA가 RPC admin_create_today_vote로 따로 호출
//
// 대상 카테고리: TODAY_CARD_CATEGORIES = daily/relationship/work/game (etc 제외)

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? ''

const OPENAI_MODEL = 'gpt-5.4-nano'
const TODAY_CATEGORIES = ['daily', 'relationship', 'work', 'game'] as const
type TodayCategory = typeof TODAY_CATEGORIES[number]

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

interface GeneratedCandidate {
  question: string
  options: string[]
}

function validateCandidate(item: unknown): item is GeneratedCandidate {
  if (typeof item !== 'object' || item === null) return false
  const i = item as Record<string, unknown>
  if (typeof i.question !== 'string') return false
  const q = i.question.trim()
  if (q.length < 4 || q.length > 60) return false

  if (!Array.isArray(i.options)) return false
  if (i.options.length < 2 || i.options.length > 5) return false
  const opts = i.options.map((o) =>
    typeof o === 'string' ? o.trim() : ''
  )
  if (opts.some((o) => o.length === 0 || o.length > 30)) return false
  if (new Set(opts.map((o) => o.toLowerCase())).size !== opts.length) return false
  return true
}

async function fetchPromptPair(
  admin: ReturnType<typeof createClient>,
): Promise<{ system: string; user: string }> {
  const { data, error } = await admin
    .from('admin_prompts')
    .select('key, value')
    .in('key', ['today_vote_gen_system', 'today_vote_gen_user'])
  if (error) throw error
  const map = new Map<string, string>()
  for (const row of (data ?? []) as { key: string; value: string }[]) {
    map.set(row.key, row.value)
  }
  const system = map.get('today_vote_gen_system')
  const user = map.get('today_vote_gen_user')
  if (!system || !user) {
    throw new Error('prompt seed missing — apply migration 20260509000001 first')
  }
  return { system, user }
}

async function callOpenAI(
  systemPrompt: string,
  userPrompt: string,
): Promise<GeneratedCandidate> {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY not configured')
  }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      max_completion_tokens: 256,
      temperature: 0.9,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`OpenAI API error ${res.status}: ${errText.slice(0, 300)}`)
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  const text = data.choices?.[0]?.message?.content ?? ''
  if (!text) throw new Error('OpenAI response empty')

  const parsed = JSON.parse(text) as unknown
  if (!validateCandidate(parsed)) {
    throw new Error('OpenAI response failed validation')
  }
  return {
    question: parsed.question.trim(),
    options: parsed.options.map((o) => o.trim()),
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') {
    return withCors(new Response('Method Not Allowed', { status: 405 }))
  }

  let category: TodayCategory
  try {
    const body = await req.json()
    if (
      typeof body?.category !== 'string' ||
      !TODAY_CATEGORIES.includes(body.category as TodayCategory)
    ) {
      return withCors(
        new Response('Bad Request: category must be one of daily/relationship/work/game', {
          status: 400,
        }),
      )
    }
    category = body.category as TodayCategory
  } catch {
    return withCors(new Response('Bad Request: invalid JSON', { status: 400 }))
  }

  const authHeader = req.headers.get('authorization') ?? ''
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return withCors(new Response('Unauthorized', { status: 401 }))
  }
  const userClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userErr } = await userClient.auth.getUser()
  if (userErr || !userData?.user) {
    return withCors(new Response('Unauthorized', { status: 401 }))
  }
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: profile, error: profileErr } = await adminClient
    .from('users')
    .select('is_admin')
    .eq('id', userData.user.id)
    .single()
  if (profileErr || !profile || (profile as { is_admin?: boolean }).is_admin !== true) {
    return withCors(new Response('Forbidden: admin only', { status: 403 }))
  }

  try {
    const { system, user } = await fetchPromptPair(adminClient)
    const userPrompt = user.replaceAll('{category}', category)

    let candidate: GeneratedCandidate
    try {
      candidate = await callOpenAI(system, userPrompt)
    } catch (firstErr) {
      console.warn(
        '[admin-generate-today-candidate] retry after first failure:',
        String(firstErr),
      )
      candidate = await callOpenAI(system, userPrompt)
    }

    return withCors(
      Response.json({
        ok: true,
        question: candidate.question,
        options: candidate.options,
        prompt_version: 'admin_prompts:today_vote_gen',
      }),
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[admin-generate-today-candidate] failed:', msg)
    return withCors(
      Response.json({ ok: false, error: msg }, { status: 502 }),
    )
  }
})
