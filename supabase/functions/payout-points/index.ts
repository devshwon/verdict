// 토스포인트 지급 워커 (앱인토스 비즈월렛 promotion API 연동)
//
// 흐름:
//   1) pg_cron이 5분마다 이 함수 호출 (Authorization: Bearer SERVICE_ROLE_KEY)
//   2) fn_get_pending_payouts RPC로 처리 대상 + toss_user_key + promotion_id 조회
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

Deno.serve(async (req) => {
  const authHeader = req.headers.get('authorization') ?? ''
  const expected = `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
  if (authHeader !== expected) {
    return Response.json(
      { ok: false, error: 'service_role required' },
      { status: 401 },
    )
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
    const { data: pending, error: fetchErr } = await admin.rpc(
      'fn_get_pending_payouts',
      { p_batch_size: BATCH_SIZE },
    )
    if (fetchErr) throw fetchErr

    const rows = (pending ?? []) as PendingRow[]
    if (rows.length === 0) {
      return Response.json({
        ok: true,
        processed: 0,
        succeeded: 0,
        failed: 0,
        unmapped: 0,
        dry_run: DRY_RUN,
        mtls_configured: mtlsConfigured,
      })
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

    return Response.json({
      ok: true,
      processed: rows.length,
      succeeded,
      failed,
      unmapped,
      dry_run: DRY_RUN,
      mtls_configured: mtlsConfigured,
      errors: errors.slice(0, 10),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[payout-points] error:', msg)
    return Response.json({ ok: false, error: msg }, { status: 500 })
  }
})
