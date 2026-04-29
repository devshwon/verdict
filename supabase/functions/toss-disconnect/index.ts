// Toss "연결 끊기" 콜백 수신 Edge Function
//
// 트리거 조건 (referrer):
//   - UNLINK             : 사용자가 토스 앱 설정에서 직접 연결 해제
//   - WITHDRAWAL_TERMS   : 토스 로그인 약관 동의 철회
//   - WITHDRAWAL_TOSS    : 토스 계정 자체를 탈퇴
//
// 인증: Basic Auth (Toss 콘솔에 등록한 ID/PW)
//
// 동작:
//   1) Basic Auth 검증
//   2) toss_user_key로 public.users 조회
//   3) 매칭된 사용자 있으면 auth.users 삭제 → CASCADE로 public.users·votes·vote_casts 모두 삭제
//      points_log는 SET NULL로 익명화 (회계 기록 보존)
//   4) 멱등 처리: 이미 삭제된 사용자에 대한 재호출도 200 OK 응답
//
// Endpoint URL:
//   https://oclmcgsjucfyyhjtaktt.supabase.co/functions/v1/toss-disconnect

import { createClient } from 'jsr:@supabase/supabase-js@2'

const TOSS_BASIC_AUTH_USER = Deno.env.get('TOSS_BASIC_AUTH_USER') ?? ''
const TOSS_BASIC_AUTH_PASS = Deno.env.get('TOSS_BASIC_AUTH_PASS') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

type Referrer = 'UNLINK' | 'WITHDRAWAL_TERMS' | 'WITHDRAWAL_TOSS'

interface DisconnectPayload {
  userKey: string
  referrer: Referrer
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
}

function withCors(res: Response): Response {
  const headers = new Headers(res.headers)
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
  return new Response(res.body, { status: res.status, headers })
}

function verifyBasicAuth(authHeader: string | null): boolean {
  if (!TOSS_BASIC_AUTH_USER || !TOSS_BASIC_AUTH_PASS) {
    console.error('Server misconfig: TOSS_BASIC_AUTH_USER/PASS not set')
    return false
  }
  if (!authHeader?.startsWith('Basic ')) return false
  let decoded: string
  try {
    decoded = atob(authHeader.slice(6).trim())
  } catch {
    return false
  }
  const idx = decoded.indexOf(':')
  if (idx < 0) return false
  return (
    decoded.slice(0, idx) === TOSS_BASIC_AUTH_USER &&
    decoded.slice(idx + 1) === TOSS_BASIC_AUTH_PASS
  )
}

async function parsePayload(req: Request): Promise<DisconnectPayload | null> {
  const tryReturn = (userKey: unknown, referrer: unknown): DisconnectPayload | null => {
    if (
      (typeof userKey === 'string' || typeof userKey === 'number') &&
      typeof referrer === 'string'
    ) {
      return { userKey: String(userKey), referrer: referrer as Referrer }
    }
    return null
  }

  if (req.method === 'POST') {
    const contentType = req.headers.get('content-type') ?? ''
    const rawBody = await req.text()

    if (contentType.includes('application/x-www-form-urlencoded')) {
      const params = new URLSearchParams(rawBody)
      return tryReturn(params.get('userKey'), params.get('referrer'))
    }

    // JSON (Content-Type 누락 케이스 포함)
    try {
      const body = JSON.parse(rawBody)
      return tryReturn(body?.userKey, body?.referrer)
    } catch {
      return null
    }
  }

  if (req.method === 'GET') {
    const url = new URL(req.url)
    return tryReturn(url.searchParams.get('userKey'), url.searchParams.get('referrer'))
  }

  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  if (req.method !== 'POST' && req.method !== 'GET') {
    return withCors(new Response('Method Not Allowed', { status: 405 }))
  }

  if (!verifyBasicAuth(req.headers.get('Authorization'))) {
    return withCors(new Response('Unauthorized', { status: 401 }))
  }

  const payload = await parsePayload(req)
  if (!payload) {
    return withCors(new Response('Bad Request: userKey and referrer required', { status: 400 }))
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: user, error: lookupError } = await admin
    .from('users')
    .select('id')
    .eq('toss_user_key', payload.userKey)
    .maybeSingle()

  if (lookupError) {
    console.error('Lookup failed:', lookupError)
    return withCors(new Response('Internal error', { status: 500 }))
  }

  if (!user) {
    return withCors(Response.json({ ok: true, status: 'not_found', referrer: payload.referrer }))
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id)
  if (deleteError) {
    console.error('Delete failed:', deleteError)
    return withCors(new Response('Failed to delete user', { status: 500 }))
  }

  console.log(`User deleted: id=${user.id}, referrer=${payload.referrer}`)
  return withCors(Response.json({ ok: true, status: 'deleted', referrer: payload.referrer }))
})
