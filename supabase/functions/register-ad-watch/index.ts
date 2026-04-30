// 광고 시청 콜백 검증 + 토큰 발급 Edge Function (백로그 §S2)
//
// 흐름:
//   1) 클라이언트가 광고 시청 (시뮬레이션 또는 실 SDK)
//   2) 시청 완료 시 이 함수에 { ad_unit, sdk_payload } 전달
//   3) 함수가 사용자 인증 + 일일 캡 + sdk_payload 검증 (실 SDK 통합 시)
//   4) ad_watches INSERT (callback_token = uuid 발급)
//   5) 클라이언트는 토큰을 받아 후속 RPC에 전달 (5분 유효)
//
// 일일 캡:
//   - ad_unit별 (예: register_3plus 50회/일)
//   - 합계 100회/일
//
// 환경변수:
//   - SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (자동 주입)

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const VALID_AD_UNITS = [
  'register_3plus',
  'unlock_vote_result',
  'mypage_free_pass',
  'general',
] as const
type AdUnit = (typeof VALID_AD_UNITS)[number]

// 일일 캡 (KST 기준)
const PER_UNIT_DAILY_CAP: Record<AdUnit, number> = {
  register_3plus: 50,
  unlock_vote_result: 50,
  mypage_free_pass: 1,    // 1일 1회 강제 (RPC가 별도 검증하지만 여기서도 1차 차단)
  general: 100,
}
const TOTAL_DAILY_CAP = 100

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

function isValidAdUnit(s: unknown): s is AdUnit {
  return typeof s === 'string' && (VALID_AD_UNITS as readonly string[]).includes(s)
}

// TODO: 실제 토스 리워드 광고 SDK 콜백 서명 검증 (현재는 시뮬레이션 통과)
// 실 SDK 통합 시 sdk_payload에서 서명/타임스탬프/광고 단위 ID를 추출해 검증.
function verifySdkPayload(_payload: unknown, _adUnit: AdUnit): boolean {
  return true
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') {
    return withCors(new Response('Method Not Allowed', { status: 405 }))
  }

  // 사용자 인증 — Authorization 헤더의 JWT를 anon client로 검증
  const authHeader = req.headers.get('authorization') ?? ''
  const accessToken = authHeader.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length)
    : ''
  if (!accessToken) {
    return withCors(
      Response.json({ ok: false, error: 'auth required' }, { status: 401 }),
    )
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  })
  const { data: userData, error: userErr } = await userClient.auth.getUser()
  if (userErr || !userData.user) {
    return withCors(
      Response.json({ ok: false, error: 'auth invalid' }, { status: 401 }),
    )
  }
  const userId = userData.user.id

  // 본문 파싱
  let adUnit: AdUnit
  let sdkPayload: unknown
  try {
    const body = await req.json()
    if (!isValidAdUnit(body?.ad_unit)) {
      return withCors(
        Response.json(
          { ok: false, error: 'invalid ad_unit' },
          { status: 400 },
        ),
      )
    }
    adUnit = body.ad_unit
    sdkPayload = body.sdk_payload ?? null
  } catch {
    return withCors(
      Response.json({ ok: false, error: 'invalid JSON' }, { status: 400 }),
    )
  }

  if (!verifySdkPayload(sdkPayload, adUnit)) {
    return withCors(
      Response.json(
        { ok: false, error: 'sdk_payload verification failed' },
        { status: 400 },
      ),
    )
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  try {
    // 일일 캡 검증 — KST 기준 자정부터 카운트
    const kstTodayStart = new Date(
      new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }),
    )
    kstTodayStart.setHours(0, 0, 0, 0)
    const kstTodayStartIso = kstTodayStart.toISOString()

    const { count: unitCount, error: unitErr } = await admin
      .from('ad_watches')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('ad_unit', adUnit)
      .gte('watched_at', kstTodayStartIso)
    if (unitErr) throw unitErr
    if ((unitCount ?? 0) >= PER_UNIT_DAILY_CAP[adUnit]) {
      return withCors(
        Response.json(
          {
            ok: false,
            error: `daily cap reached for ${adUnit} (${PER_UNIT_DAILY_CAP[adUnit]}/day)`,
            code: 'cap_reached',
          },
          { status: 429 },
        ),
      )
    }

    const { count: totalCount, error: totalErr } = await admin
      .from('ad_watches')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('watched_at', kstTodayStartIso)
    if (totalErr) throw totalErr
    if ((totalCount ?? 0) >= TOTAL_DAILY_CAP) {
      return withCors(
        Response.json(
          {
            ok: false,
            error: `total daily ad cap reached (${TOTAL_DAILY_CAP}/day)`,
            code: 'cap_reached',
          },
          { status: 429 },
        ),
      )
    }

    // 토큰 발급 + INSERT
    const callbackToken = crypto.randomUUID()
    const { error: insErr } = await admin.from('ad_watches').insert({
      user_id: userId,
      ad_unit: adUnit,
      callback_token: callbackToken,
      sdk_payload: sdkPayload as Record<string, unknown> | null,
    })
    if (insErr) throw insErr

    return withCors(
      Response.json({
        ok: true,
        ad_token: callbackToken,
        ad_unit: adUnit,
        // 토큰 유효기간 (5분) — 클라이언트가 만료 임박 시 재발급 받도록 노출
        expires_in_seconds: 300,
      }),
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[register-ad-watch] error:', msg)
    return withCors(
      Response.json({ ok: false, error: msg }, { status: 500 }),
    )
  }
})
