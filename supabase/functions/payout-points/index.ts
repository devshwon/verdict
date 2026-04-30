// 토스포인트 지급 워커 (백로그 §S3, 기획서 §7-1)
//
// 흐름:
//   1) pg_cron이 5분마다 이 함수 호출 (Authorization: Bearer SERVICE_ROLE_KEY)
//   2) fn_get_pending_payouts RPC로 처리 대상 조회 (신규 24h 지연 + 일일 한도 사전 검증)
//   3) 각 row에 대해 토스 비즈월렛 리워드 API 호출 (mTLS)
//   4) 성공 → fn_complete_payout(id, transaction_id)
//      실패 → fn_fail_payout(id) — 재시도는 다음 사이클이 아닌 운영자 수동 (반복 실패 누적 방지)
//
// 환경변수:
//   - SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (자동 주입)
//   - TOSS_BIZWALLET_API_KEY (Supabase secret)
//   - TOSS_BIZWALLET_BASE_URL (선택, 기본 sandbox)
//   - TOSS_MTLS_CERT / TOSS_MTLS_KEY (선택, 운영 환경)
//
// 인증:
//   - 호출자가 service_role JWT 또는 SUPABASE_SERVICE_ROLE_KEY (cron job)이어야 함
//   - 일반 사용자는 호출 차단

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const TOSS_BIZWALLET_API_KEY = Deno.env.get('TOSS_BIZWALLET_API_KEY') ?? ''
const TOSS_BIZWALLET_BASE_URL = Deno.env.get('TOSS_BIZWALLET_BASE_URL') ?? ''

const BATCH_SIZE = 100

interface PendingRow {
  id: string
  user_id: string
  trigger: string
  amount: number
  related_vote_id: string | null
  created_at: string
}

interface PayoutResult {
  ok: boolean
  transactionId?: string
  error?: string
}

// 토스 비즈월렛 리워드 API 호출
// TODO: 실제 토스 API 명세에 맞게 endpoint / body 형식 조정 필요
// 현재는 환경변수가 없으면 모의 성공 처리 (개발 환경)
async function callTossBizwallet(
  userId: string,
  amount: number,
  trigger: string,
): Promise<PayoutResult> {
  if (!TOSS_BIZWALLET_API_KEY || !TOSS_BIZWALLET_BASE_URL) {
    // 모의 성공 — 운영자가 실 API 키 설정하면 실제 호출
    console.warn(
      '[payout-points] TOSS_BIZWALLET_API_KEY not set, simulating success',
    )
    return {
      ok: true,
      transactionId: `simulated-${crypto.randomUUID()}`,
    }
  }

  try {
    const response = await fetch(
      `${TOSS_BIZWALLET_BASE_URL}/v1/rewards/grant`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TOSS_BIZWALLET_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_key: userId,
          amount,
          reason_code: trigger,
          idempotency_key: `${userId}:${trigger}:${Date.now()}`,
        }),
      },
    )

    if (!response.ok) {
      const errText = await response.text()
      return {
        ok: false,
        error: `Toss bizwallet HTTP ${response.status}: ${errText.slice(0, 200)}`,
      }
    }

    const data = await response.json() as { transaction_id?: string }
    return {
      ok: true,
      transactionId: data.transaction_id ?? `unknown-${crypto.randomUUID()}`,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  }
}

Deno.serve(async (req) => {
  // 인증 — Authorization 헤더가 service_role key인지 확인
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
    // 1) 처리 대상 조회 (DB 측에서 한도 초과 사전 마킹)
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
      })
    }

    let succeeded = 0
    let failed = 0
    const errors: { id: string; error: string }[] = []

    // 2) 순차 처리 (병렬 호출 시 토스 측 rate limit 우려)
    for (const row of rows) {
      const result = await callTossBizwallet(
        row.user_id,
        row.amount,
        row.trigger,
      )

      if (result.ok && result.transactionId) {
        const { error: completeErr } = await admin.rpc('fn_complete_payout', {
          p_id: row.id,
          p_toss_transaction_id: result.transactionId,
        })
        if (completeErr) {
          failed += 1
          errors.push({ id: row.id, error: `complete RPC: ${completeErr.message}` })
        } else {
          succeeded += 1
        }
      } else {
        const { error: failErr } = await admin.rpc('fn_fail_payout', {
          p_id: row.id,
        })
        if (failErr) {
          errors.push({ id: row.id, error: `fail RPC: ${failErr.message}` })
        }
        failed += 1
        errors.push({ id: row.id, error: result.error ?? 'unknown' })
      }
    }

    return Response.json({
      ok: true,
      processed: rows.length,
      succeeded,
      failed,
      errors: errors.slice(0, 10),  // 응답 크기 제한
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[payout-points] error:', msg)
    return Response.json({ ok: false, error: msg }, { status: 500 })
  }
})
