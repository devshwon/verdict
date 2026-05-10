// 토스포인트 지급 워커 (앱인토스 비즈월렛 promotion API 연동)
//
// 두 가지 호출 모드:
//   A. cron 모드 (service_role JWT) — 5분마다 전체 pending 처리
//   B. user-scoped 모드 (일반 user JWT) — "받기" 클릭 즉시 자기 user 의 pending 만 처리
//      → user JWT 의 sub(user_id) 추출 후 fn_get_pending_payouts_for_user 호출
//
// 흐름:
//   1) cron 또는 클라이언트가 호출
//   2) 인증 분기 → 모드 결정
//   3) fn_get_pending_payouts (또는 _for_user) RPC로 처리 대상 + 매핑 조회
//   3) 매핑 누락 시 → fn_fail_payout (운영자 알림 대상)
//   4) 매핑 OK → 토스 promotion API 호출 (mTLS, 2-step)
//      - Step A: POST /api-partner/v1/apps-in-toss/promotion/execute-promotion/get-key
//                → 1시간 TTL key 발급 (사용자별)
//      - Step B: POST /api-partner/v1/apps-in-toss/promotion/execute-promotion
//                → 실제 지급 ({promotionCode, key, amount})
//      - test_mode=true 인 매핑은 promotion_id 앞에 'TEST_' prefix 부착 (콘솔의 테스트 코드 컨벤션)
//   5) 성공 → fn_complete_payout, 실패 → fn_fail_payout
//
// 환경변수:
//   - SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (자동 주입)
//   - TOSS_MTLS_CERT / TOSS_MTLS_KEY (필수, toss-auth 와 공유)
//   - TOSS_PAYOUT_DRY_RUN (선택, '1' 설정 시 emergency stop — DB 설정과 OR)
//
// DRY_RUN 결정 (cron 진입 시 1회 결정):
//   - admin_settings.payout_dry_run (DB) 와 환경변수 TOSS_PAYOUT_DRY_RUN 의 OR
//   - 어느 한쪽이라도 true 면 시뮬레이션 (실 토스 호출 없음, transaction_id="simulated-...")
//   - admin SPA 의 SettingsPage 에서 운영자가 토글 (admin-config-page.md §6 참고)
//
// 인증:
//   - 호출자가 SUPABASE_SERVICE_ROLE_KEY 보유 (cron job)이어야 함
//
// 토스 API 응답 컨벤션:
//   - HTTP 200 + { resultType: 'SUCCESS'|'FAIL', success, error: { errorCode, reason } }
//   - 4109 등 잔액/예산 부족 에러는 콘솔에서 충전 필요

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const TOSS_MTLS_CERT = Deno.env.get('TOSS_MTLS_CERT') ?? ''
const TOSS_MTLS_KEY = Deno.env.get('TOSS_MTLS_KEY') ?? ''
const ENV_DRY_RUN = Deno.env.get('TOSS_PAYOUT_DRY_RUN') === '1'

const TOSS_API_BASE = 'https://apps-in-toss-api.toss.im'
const BATCH_SIZE = 100

// CORS — 즉시 지급 모드 (브라우저/WebView 의 user-scoped 호출) 위해 필수.
// cron 호출은 server-side fetch 라 무관, 다만 일관성 위해 모든 응답에 적용.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Max-Age': '86400',
}

function withCors(res: Response): Response {
  const headers = new Headers(res.headers)
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
  return new Response(res.body, { status: res.status, headers })
}

interface PendingRow {
  id: string
  user_id: string
  toss_user_key: string | null
  trigger: string
  amount: number
  promotion_id: string | null
  promotion_test_mode: boolean
  related_vote_id: string | null
  created_at: string
}

interface PayoutResult {
  ok: boolean
  transactionId?: string
  error?: string
}

interface TossResult<T> {
  resultType: 'SUCCESS' | 'FAIL'
  success: T | null
  error: { errorCode?: string; reason?: string } | null
}

function unwrapTossResult<T>(parsed: TossResult<T>, op: string): T {
  if (
    parsed.resultType === 'SUCCESS' &&
    parsed.success !== null &&
    parsed.success !== undefined
  ) {
    return parsed.success
  }
  const code = parsed.error?.errorCode ?? 'unknown'
  const reason = parsed.error?.reason ?? '(no reason)'
  throw new Error(`Toss ${op} failed: [${code}] ${reason}`)
}

// mTLS HTTP 클라이언트 (요청마다 새로 만들고 close — toss-auth 와 동일 패턴)
function createMtlsClient(): Deno.HttpClient {
  if (!TOSS_MTLS_CERT || !TOSS_MTLS_KEY) {
    throw new Error('mTLS cert/key not configured (TOSS_MTLS_CERT / TOSS_MTLS_KEY)')
  }
  // @ts-expect-error Deno.createHttpClient 는 Supabase Edge Runtime 지원, unstable API
  return Deno.createHttpClient({
    cert: TOSS_MTLS_CERT,
    key: TOSS_MTLS_KEY,
  })
}

// Step A: 사용자별 promotion key 발급 (1시간 TTL)
async function tossGetPromotionKey(userKey: string): Promise<string> {
  const client = createMtlsClient()
  try {
    const res = await fetch(
      `${TOSS_API_BASE}/api-partner/v1/apps-in-toss/promotion/execute-promotion/get-key`,
      {
        method: 'POST',
        // @ts-expect-error client option 은 Deno fetch 확장
        client,
        headers: {
          'Content-Type': 'application/json',
          'x-toss-user-key': userKey,
        },
      },
    )
    const text = await res.text()
    if (!res.ok) {
      throw new Error(`get-key HTTP ${res.status}: ${text.slice(0, 300)}`)
    }
    const parsed = JSON.parse(text) as TossResult<{ key: string }>
    const data = unwrapTossResult(parsed, 'get-key')
    if (!data.key) throw new Error('get-key: empty key in success payload')
    return data.key
  } finally {
    client.close()
  }
}

// Step B: 프로모션 지급 실행
async function tossExecutePromotion(params: {
  userKey: string
  promotionCode: string
  key: string
  amount: number
}): Promise<{ transactionId: string; raw: unknown }> {
  const client = createMtlsClient()
  try {
    const res = await fetch(
      `${TOSS_API_BASE}/api-partner/v1/apps-in-toss/promotion/execute-promotion`,
      {
        method: 'POST',
        // @ts-expect-error client option 은 Deno fetch 확장
        client,
        headers: {
          'Content-Type': 'application/json',
          'x-toss-user-key': params.userKey,
        },
        body: JSON.stringify({
          promotionCode: params.promotionCode,
          key: params.key,
          amount: params.amount,
        }),
      },
    )
    const text = await res.text()
    if (!res.ok) {
      throw new Error(`execute-promotion HTTP ${res.status}: ${text.slice(0, 300)}`)
    }
    const parsed = JSON.parse(text) as TossResult<Record<string, unknown>>
    const data = unwrapTossResult(parsed, 'execute-promotion')
    // 토스 응답에서 transactionId 후보 키 검출 (문서가 응답 필드를 명시하지 않을 가능성 대비)
    const tx =
      (data.transactionId as string | undefined) ??
      (data.transaction_id as string | undefined) ??
      (data.id as string | undefined)
    return {
      transactionId: tx ?? `unknown-${crypto.randomUUID()}`,
      raw: data,
    }
  } finally {
    client.close()
  }
}

// 매핑 1건 지급
async function payoutOne(row: PendingRow, dryRun: boolean): Promise<PayoutResult> {
  if (!row.promotion_id) {
    return {
      ok: false,
      error: `promotion mapping missing for trigger=${row.trigger}`,
    }
  }
  if (!row.toss_user_key) {
    return { ok: false, error: 'toss_user_key missing on user' }
  }

  // test_mode=true → 콘솔의 테스트용 promotionCode 컨벤션('TEST_<id>') 적용
  const promotionCode = row.promotion_test_mode
    ? `TEST_${row.promotion_id}`
    : row.promotion_id

  if (dryRun) {
    console.warn(
      `[payout-points] dry-run promotion=${promotionCode} user_key=${row.toss_user_key} amount=${row.amount}`,
    )
    return { ok: true, transactionId: `simulated-${crypto.randomUUID()}` }
  }

  try {
    const key = await tossGetPromotionKey(row.toss_user_key)
    const result = await tossExecutePromotion({
      userKey: row.toss_user_key,
      promotionCode,
      key,
      amount: row.amount,
    })
    return { ok: true, transactionId: result.transactionId }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  }
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

// service_role 인증 검사
//   1차: env var 와 정확 일치 (legacy 동작 보존)
//   2차: JWT payload 의 role=service_role (legacy/new key 시스템 모두 호환)
//   verify_jwt=true 가 활성이라 Supabase 가 1차 서명 검증 → 도달한 JWT 는 valid
function isServiceRoleAuth(authHeader: string): boolean {
  const m = /^Bearer (.+)$/.exec(authHeader)
  if (!m) return false
  const token = m[1]
  if (token === SUPABASE_SERVICE_ROLE_KEY) return true
  const payload = decodeJwtPayload(token)
  return payload?.role === 'service_role'
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// 일반 user JWT 에서 user_id(sub) 추출.
// 인증 검증 우선순위:
//   1) role='authenticated' (legacy supabase auth JWT)
//   2) role 필드 없어도 sub 가 UUID 형식이면 인증된 사용자로 간주
//      (Supabase 새 publishable/secret keys 시스템 호환)
// anon key 는 sub 없거나 비-UUID 라 자동 reject.
function extractAuthenticatedUserId(authHeader: string): string | null {
  const m = /^Bearer (.+)$/.exec(authHeader)
  if (!m) return null
  const payload = decodeJwtPayload(m[1])
  if (!payload) return null
  const sub = payload.sub
  if (typeof sub !== 'string') return null
  if (payload.role === 'authenticated') return sub
  // role 없음 — sub 가 UUID 면 user 로 신뢰
  if (UUID_RE.test(sub)) return sub
  return null
}

Deno.serve(async (req) => {
  // CORS preflight — 토스 인앱 WebView 가 cross-origin POST 전 OPTIONS 보냄
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  const authHeader = req.headers.get('authorization') ?? ''

  // 인증 분기 — service_role(cron 전체) 또는 일반 user JWT(자기 row 만)
  const isServiceRole = isServiceRoleAuth(authHeader)
  let scopedUserId: string | null = null
  if (!isServiceRole) {
    scopedUserId = extractAuthenticatedUserId(authHeader)
    if (!scopedUserId) {
      return withCors(
        Response.json(
          { ok: false, error: 'auth required (service_role or authenticated user)' },
          { status: 401 },
        ),
      )
    }
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // DRY_RUN 결정 — admin_settings (DB) 와 환경변수의 OR
  // 환경변수는 emergency stop (DB 가 깨지거나 admin SPA 미배포 시) 으로 살림
  let dbDryRun = false
  try {
    const { data: dryRunSetting } = await admin
      .from('admin_settings')
      .select('value')
      .eq('key', 'payout_dry_run')
      .single()
    dbDryRun = (dryRunSetting?.value as boolean) ?? false
  } catch {
    dbDryRun = false
  }
  // mTLS cert 미설정 시에도 강제 dry-run (실 호출 시 즉시 실패하는 것보단 안전)
  const mtlsConfigured = !!(TOSS_MTLS_CERT && TOSS_MTLS_KEY)
  const DRY_RUN = ENV_DRY_RUN || dbDryRun || !mtlsConfigured

  try {
    // 호출 모드 분기:
    //   - cron(service_role): 전체 user 의 pending 처리
    //   - user-scoped(일반 user JWT): 자기 user 의 pending 만 처리
    const { data: pending, error: fetchErr } = scopedUserId
      ? await admin.rpc('fn_get_pending_payouts_for_user', {
          p_user_id: scopedUserId,
          p_batch_size: BATCH_SIZE,
        })
      : await admin.rpc('fn_get_pending_payouts', { p_batch_size: BATCH_SIZE })
    if (fetchErr) throw fetchErr

    const rows = (pending ?? []) as PendingRow[]
    if (rows.length === 0) {
      return withCors(Response.json({
        ok: true,
        processed: 0,
        succeeded: 0,
        failed: 0,
        unmapped: 0,
        dry_run: DRY_RUN,
        mtls_configured: mtlsConfigured,
        mode: scopedUserId ? 'user' : 'cron',
      }))
    }

    let succeeded = 0
    let failed = 0
    let unmapped = 0
    const errors: { id: string; trigger: string; error: string }[] = []

    for (const row of rows) {
      // 매핑 누락은 별도 카운트 (운영자 알림 대상)
      if (!row.promotion_id) {
        unmapped += 1
        await admin.rpc('fn_fail_payout', { p_id: row.id })
        errors.push({
          id: row.id,
          trigger: row.trigger,
          error: 'promotion mapping missing',
        })
        continue
      }

      const result = await payoutOne(row, DRY_RUN)

      if (result.ok && result.transactionId) {
        const { error: completeErr } = await admin.rpc('fn_complete_payout', {
          p_id: row.id,
          p_toss_transaction_id: result.transactionId,
        })
        if (completeErr) {
          failed += 1
          errors.push({
            id: row.id,
            trigger: row.trigger,
            error: `complete RPC: ${completeErr.message}`,
          })
        } else {
          succeeded += 1
        }
      } else {
        await admin.rpc('fn_fail_payout', { p_id: row.id })
        failed += 1
        errors.push({
          id: row.id,
          trigger: row.trigger,
          error: result.error ?? 'unknown',
        })
      }
    }

    return withCors(Response.json({
      ok: true,
      processed: rows.length,
      succeeded,
      failed,
      unmapped,
      dry_run: DRY_RUN,
      mtls_configured: mtlsConfigured,
      mode: scopedUserId ? 'user' : 'cron',
      errors: errors.slice(0, 10),
    }))
  } catch (e) {
    // Supabase PostgrestError 는 Error 인스턴스가 아닌 plain object — String(e)='[object Object]' 회피
    const msg =
      e instanceof Error
        ? e.message
        : typeof e === 'object' && e !== null
          ? JSON.stringify(e)
          : String(e)
    console.error('[payout-points] error:', msg)
    return withCors(Response.json({ ok: false, error: msg }, { status: 500 }))
  }
})
