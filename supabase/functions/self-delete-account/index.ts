// 본인 계정 탈퇴 (미니앱 측 트리거)
//
// 흐름:
//   1) 클라이언트가 user JWT (Authorization: Bearer <user_access_token>) 와 함께 호출
//   2) JWT 의 sub(user_id) 추출
//   3) admin client 로 auth.admin.deleteUser(user_id)
//      → CASCADE 로 public.users / votes / vote_casts 등 자동 삭제
//      → points_log 는 SET NULL 로 익명화 (회계 기록 보존)
//   4) 클라이언트는 응답 받은 후 supabase.auth.signOut() + reload
//
// 토스 측 "연결 끊기" (toss-disconnect) 와는 별개:
//   - 본 함수는 미니앱 사용자가 자발적으로 본인 데이터를 삭제하는 흐름
//   - 토스 계정과의 연결 자체는 토스 앱 설정에서 끊어야 함
//   - 다음 로그인 시 새 사용자로 createUser 되어 신규 가입처럼 동작

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

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

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.')
    if (parts.length < 2) return null
    const payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const pad = (4 - (payloadB64.length % 4)) % 4
    return JSON.parse(atob(payloadB64 + '='.repeat(pad)))
  } catch {
    return null
  }
}

function extractAuthenticatedUserId(authHeader: string): string | null {
  const m = /^Bearer (.+)$/.exec(authHeader)
  if (!m) return null
  const payload = decodeJwtPayload(m[1])
  if (!payload) return null
  if (payload.role !== 'authenticated') return null
  return typeof payload.sub === 'string' ? payload.sub : null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') {
    return withCors(new Response('Method Not Allowed', { status: 405 }))
  }

  const authHeader = req.headers.get('authorization') ?? ''
  const userId = extractAuthenticatedUserId(authHeader)
  if (!userId) {
    return withCors(
      Response.json({ ok: false, error: 'auth required' }, { status: 401 }),
    )
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  try {
    const { error } = await admin.auth.admin.deleteUser(userId)
    if (error) {
      // user 가 이미 없으면 멱등 성공 처리
      if (error.message?.toLowerCase().includes('not found')) {
        return withCors(Response.json({ ok: true, alreadyDeleted: true }))
      }
      throw error
    }
    return withCors(Response.json({ ok: true }))
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[self-delete-account] error:', msg)
    return withCors(Response.json({ ok: false, error: msg }, { status: 500 }))
  }
})
