// 토스포인트 지급 워커 (백로그 §S3, 기획서 §7-1)
//
// 흐름:
//   1) pg_cron이 5분마다 이 함수 호출 (Authorization: Bearer SERVICE_ROLE_KEY)
//   2) fn_get_pending_payouts RPC로 처리 대상 + toss_user_key + promotion_id 조회
//   3) 매핑 누락 시 → fn_fail_payout (운영자 알림 대상)
//   4) 매핑 OK → 토스 비즈월렛 promotion grant API 호출
//      - test_mode=true 인 매핑은 promotion_id 앞에 'TEST_' prefix 자동 부착
//   5) 성공 → fn_complete_payout, 실패 → fn_fail_payout
//
// 환경변수:
//   - SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (자동 주입)
//   - TOSS_BIZWALLET_API_KEY (Supabase secret)
//   - TOSS_BIZWALLET_BASE_URL (선택, 기본: 운영 endpoint)
//   - TOSS_PAYOUT_DRY_RUN (선택, '1' 설정 시 외부 호출 없이 모의 성공 — 로컬/CI용)
//
// 인증:
//   - 호출자가 SUPABASE_SERVICE_ROLE_KEY 보유 (cron job)이어야 함

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const TOSS_BIZWALLET_API_KEY = Deno.env.get('TOSS_BIZWALLET_API_KEY') ?? ''
const TOSS_BIZWALLET_BASE_URL = Deno.env.get('TOSS_BIZWALLET_BASE_URL') ?? ''
const TOSS_PAYOUT_DRY_RUN = Deno.env.get('TOSS_PAYOUT_DRY_RUN') === '1'

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

// 토스 비즈월렛 promotion grant API 호출
//   - 매핑된 promotion_id를 promotionCode로 사용
//   - test_mode=true 시 'TEST_' prefix 부착 (실 차감 없이 검증)
//   - idempotencyKey는 points_log row id를 그대로 사용 (DB 멱등성과 1:1 매칭)
async function callTossPromotionGrant(
  row: PendingRow,
): Promise<PayoutResult> {
  if (!row.promotion_id) {
    return {
      ok: false,
      error: `promotion mapping missing for trigger=${row.trigger}`,
    }
  }
  if (!row.toss_user_key) {
    return { ok: false, error: 'toss_user_key missing on user' }
  }

  const promotionCode = row.promotion_test_mode
    ? `TEST_${row.promotion_id}`
    : row.promotion_id

  if (TOSS_PAYOUT_DRY_RUN || !TOSS_BIZWALLET_API_KEY || !TOSS_BIZWALLET_BASE_URL) {
    console.warn(
      `[payout-points] dry-run promotion=${promotionCode} user_key=${row.toss_user_key} amount=${row.amount}`,
    )
    return {
      ok: true,
      transactionId: `simulated-${crypto.randomUUID()}`,
    }
  }

  try {
    const response = await fetch(
      `${TOSS_BIZWALLET_BASE_URL}/v1/promotion/grant`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TOSS_BIZWALLET_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          promotionCode,
          userKey: row.toss_user_key,
          amount: row.amount,
          idempotencyKey: row.id,
        }),
      },
    )

    if (!response.ok) {
      const errText = await response.text()
      return {
        ok: false,
        error: `Toss HTTP ${response.status}: ${errText.slice(0, 200)}`,
      }
    }

    const data = await response.json() as {
      transactionId?: string
      transaction_id?: string
    }
    return {
      ok: true,
      transactionId: data.transactionId ?? data.transaction_id ?? `unknown-${crypto.randomUUID()}`,
    }
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

      const result = await callTossPromotionGrant(row)

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
      errors: errors.slice(0, 10),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[payout-points] error:', msg)
    return Response.json({ ok: false, error: msg }, { status: 500 })
  }
})
