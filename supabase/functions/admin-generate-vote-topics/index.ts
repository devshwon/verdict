// Admin 일반투표 주제 일괄 생성기 (DoD: docs/operations/admin-pre-launch-content-tools.md §3-3)
//
// 흐름:
//   1) Authorization 헤더의 user JWT로 Supabase 클라이언트 생성 → users.is_admin 확인
//   2) admin_prompts에서 normal_vote_gen_system / normal_vote_gen_user 조회 (service_role)
//   3) {category} {count} {exclude} placeholder 치환
//   4) OpenAI Chat Completions (gpt-4o-mini, JSON 모드) 호출
//   5) 응답 JSON 스키마 검증 (실패 시 1회 재시도)
//   6) 검증 통과 항목만 미리보기로 반환 — DB 저장은 SPA가 RPC admin_create_normal_vote로 따로 호출
//
// 환경변수:
//   - OPENAI_API_KEY (Supabase secret)
//   - SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (자동 주입)
//
// 비용 (1회): 입력 ~600 토큰, 출력 ~250 토큰 → gpt-4o-mini ₩0.18 / 회

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? ''

const OPENAI_MODEL = 'gpt-4o-mini'
const ALLOWED_CATEGORIES = ['daily', 'relationship', 'work', 'game', 'etc'] as const
type Category = typeof ALLOWED_CATEGORIES[number]

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

interface GeneratedItem {
  question: string
  options: string[]
}

function validateItem(item: unknown): item is GeneratedItem {
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
    .in('key', ['normal_vote_gen_system', 'normal_vote_gen_user'])
  if (error) throw error
  const map = new Map<string, string>()
  for (const row of (data ?? []) as { key: string; value: string }[]) {
    map.set(row.key, row.value)
  }
  const system = map.get('normal_vote_gen_system')
  const user = map.get('normal_vote_gen_user')
  if (!system || !user) {
    throw new Error('prompt seed missing — apply migration 20260509000001 first')
  }
  return { system, user }
}

function fillUserPrompt(
  template: string,
  category: Category,
  count: number,
  exclude: string[],
): string {
  const excludeBlock =
    exclude.length === 0
      ? '(없음)'
      : exclude.map((q, i) => `${i + 1}. ${q}`).join('\n')
  return template
    .replaceAll('{category}', category)
    .replaceAll('{count}', String(count))
    .replaceAll('{exclude}', excludeBlock)
}

async function callOpenAI(
  systemPrompt: string,
  userPrompt: string,
  count: number,
): Promise<GeneratedItem[]> {
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
      max_tokens: 800,
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

  const parsed = JSON.parse(text) as { items?: unknown[] }
  if (!Array.isArray(parsed.items)) {
    throw new Error('OpenAI response missing items array')
  }

  const valid = parsed.items.filter(validateItem) as GeneratedItem[]
  if (valid.length === 0) {
    throw new Error('no valid items after validation')
  }
  // 요청한 개수 이내로 자름. 부족하면 호출자가 추가 요청
  return valid.slice(0, count).map((i) => ({
    question: i.question.trim(),
    options: i.options.map((o) => o.trim()),
  }))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') {
    return withCors(new Response('Method Not Allowed', { status: 405 }))
  }

  // ── 입력 파싱 ───────────────────────────────────────
  let category: Category
  let count: number
  let exclude: string[]
  try {
    const body = await req.json()
    if (
      typeof body?.category !== 'string' ||
      !ALLOWED_CATEGORIES.includes(body.category as Category)
    ) {
      return withCors(new Response('Bad Request: invalid category', { status: 400 }))
    }
    category = body.category as Category

    count = Number(body?.count ?? 3)
    if (!Number.isInteger(count) || count < 2 || count > 5) {
      return withCors(new Response('Bad Request: count must be 2~5', { status: 400 }))
    }

    exclude = Array.isArray(body?.exclude_questions)
      ? (body.exclude_questions as unknown[])
          .filter((q): q is string => typeof q === 'string')
          .map((q) => q.trim())
          .filter((q) => q.length > 0)
          .slice(0, 20)
      : []
  } catch {
    return withCors(new Response('Bad Request: invalid JSON', { status: 400 }))
  }

  // ── is_admin 가드 (user JWT) ────────────────────────
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

  // ── 프롬프트 + OpenAI 호출 (1회 재시도) ─────────────
  try {
    const { system, user } = await fetchPromptPair(adminClient)
    const userPrompt = fillUserPrompt(user, category, count, exclude)

    let items: GeneratedItem[]
    try {
      items = await callOpenAI(system, userPrompt, count)
    } catch (firstErr) {
      console.warn('[admin-generate-vote-topics] retry after first failure:', String(firstErr))
      items = await callOpenAI(system, userPrompt, count)
    }

    return withCors(
      Response.json({
        ok: true,
        items,
        prompt_version: 'admin_prompts:normal_vote_gen',
      }),
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[admin-generate-vote-topics] failed:', msg)
    return withCors(
      Response.json({ ok: false, error: msg }, { status: 502 }),
    )
  }
})
