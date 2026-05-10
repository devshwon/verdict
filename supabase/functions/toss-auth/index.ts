// Toss 로그인 → Supabase 세션 브릿지 Edge Function
//
// 흐름:
//   1) 클라이언트가 appLogin()으로 받은 authorizationCode를 우리 함수로 전달
//   2) (mTLS) 토스 generate-token API로 accessToken 교환
//   3) (mTLS) 토스 login-me API로 사용자 정보 조회 (userKey, gender 등)
//   4) public.users + auth.users upsert (toss_user_key 기준)
//   5) admin.generateLink('magiclink')로 일회용 토큰 발급
//   6) 클라이언트는 받은 token_hash로 supabase.auth.verifyOtp() 호출 → 세션 확립
//
// TODO:
//   - birthday 등 암호화 필드 AES-256-GCM 복호화 (AAD 확보 후)
//   - age_bucket은 birthday 복호화 후에 정확하게 설정 (현재는 'undisclosed')

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const TOSS_MTLS_CERT = Deno.env.get('TOSS_MTLS_CERT') ?? ''
const TOSS_MTLS_KEY = Deno.env.get('TOSS_MTLS_KEY') ?? ''
// 토스 콘솔에서 발급받은 정적 AES-256 키 (base64).
// login-me 응답의 PII 필드는 이 키로 AES-256-GCM 암호화되어 옴.
// envelope = [12B IV][N bytes ciphertext][16B authTag] (모든 필드 IV 동일)
const TOSS_DECRYPT_KEY = Deno.env.get('TOSS_DECRYPT_KEY') ?? ''
// fallback referrer (클라이언트에서 referrer 못 받은 경우만 사용)
const TOSS_REFERRER_FALLBACK = Deno.env.get('TOSS_REFERRER') ?? 'DEFAULT'
type Referrer = 'DEFAULT' | 'sandbox'

// 클라이언트가 어떤 케이스로 보내든 토스 generate-token이 받는 형식으로 정규화
// SDK는 'SANDBOX'(대문자)를 반환하지만 Toss API는 'sandbox'(소문자)를 명시
function normalizeReferrer(input: string): Referrer | null {
  const trimmed = input.trim()
  if (trimmed === 'DEFAULT' || trimmed === 'default') return 'DEFAULT'
  if (trimmed === 'SANDBOX' || trimmed === 'sandbox') return 'sandbox'
  return null
}

const TOSS_API_BASE = 'https://apps-in-toss-api.toss.im'
const SYNTHETIC_EMAIL_DOMAIN = 'verdict.local'

// supabase-js functions.invoke는 apikey, x-client-info 헤더를 자동 부착.
// preflight에서 누락 시 브라우저가 실제 POST를 차단 → 함수 미도달.
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

// mTLS HTTP 클라이언트 (요청마다 새로 만들고 close)
function createMtlsClient(): Deno.HttpClient {
  if (!TOSS_MTLS_CERT || !TOSS_MTLS_KEY) {
    throw new Error('mTLS cert/key not configured (TOSS_MTLS_CERT / TOSS_MTLS_KEY)')
  }
  // @ts-expect-error Deno.createHttpClient는 Supabase Edge Runtime에서 지원되나 unstable API
  return Deno.createHttpClient({
    cert: TOSS_MTLS_CERT,
    key: TOSS_MTLS_KEY,
  })
}

// 토스 API는 HTTP 200으로 응답하고 body의 resultType으로 성공/실패를 표현
// 성공: { resultType: 'SUCCESS', success: <데이터>, error: null }
// 실패: { resultType: 'FAIL', success: null, error: { errorCode, reason, ... } }
interface TossResult<T> {
  resultType: 'SUCCESS' | 'FAIL'
  success: T | null
  error: { errorCode?: string; reason?: string } | null
}

function unwrapTossResult<T>(parsed: TossResult<T>, op: string): T {
  if (parsed.resultType === 'SUCCESS' && parsed.success !== null && parsed.success !== undefined) {
    return parsed.success
  }
  const code = parsed.error?.errorCode ?? 'unknown'
  const reason = parsed.error?.reason ?? '(no reason)'
  throw new Error(`Toss ${op} failed: [${code}] ${reason}`)
}

async function tossExchangeToken(authCode: string, referrer: Referrer): Promise<{
  accessToken: string
  refreshToken: string
  expiresIn: number
  scope: string
  tokenType: string
}> {
  const client = createMtlsClient()
  try {
    const res = await fetch(
      `${TOSS_API_BASE}/api-partner/v1/apps-in-toss/user/oauth2/generate-token`,
      {
        method: 'POST',
        // @ts-expect-error client option은 Deno fetch 확장
        client,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authorizationCode: authCode, referrer }),
      },
    )
    const text = await res.text()
    if (!res.ok) {
      throw new Error(`Toss generate-token HTTP ${res.status}: ${text.slice(0, 300)}`)
    }
    const parsed = JSON.parse(text) as TossResult<{
      accessToken: string
      refreshToken: string
      expiresIn: number
      scope: string
      tokenType: string
    }>
    return unwrapTossResult(parsed, 'generate-token')
  } finally {
    client.close()
  }
}

async function tossLoginMe(accessToken: string): Promise<Record<string, unknown>> {
  const client = createMtlsClient()
  try {
    const res = await fetch(
      `${TOSS_API_BASE}/api-partner/v1/apps-in-toss/user/oauth2/login-me`,
      {
        method: 'GET',
        // @ts-expect-error client option은 Deno fetch 확장
        client,
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    )
    const text = await res.text()
    if (!res.ok) {
      throw new Error(`Toss login-me HTTP ${res.status}: ${text.slice(0, 300)}`)
    }
    const parsed = JSON.parse(text) as TossResult<Record<string, unknown>>
    const data = unwrapTossResult(parsed, 'login-me')
    return data
  } finally {
    client.close()
  }
}

// base64 → Uint8Array
function b64ToBytes(b64: string): Uint8Array {
  const norm = b64.replace(/-/g, '+').replace(/_/g, '/')
  const pad = (4 - (norm.length % 4)) % 4
  return Uint8Array.from(atob(norm + '='.repeat(pad)), (c) => c.charCodeAt(0))
}

// 토스 정적 키 캐시 (요청마다 importKey 비용 회피)
let cachedDecryptKey: CryptoKey | null = null
async function getDecryptKey(): Promise<CryptoKey | null> {
  if (cachedDecryptKey) return cachedDecryptKey
  if (!TOSS_DECRYPT_KEY) return null
  try {
    const raw = b64ToBytes(TOSS_DECRYPT_KEY)
    if (raw.byteLength !== 32) {
      console.warn(`[toss-auth] TOSS_DECRYPT_KEY length=${raw.byteLength}, expected 32`)
      return null
    }
    cachedDecryptKey = await crypto.subtle.importKey(
      'raw',
      raw,
      { name: 'AES-GCM' },
      false,
      ['decrypt'],
    )
    return cachedDecryptKey
  } catch (e) {
    console.error('[toss-auth] importKey failed:', e instanceof Error ? e.message : e)
    return null
  }
}

// AAD 후보 빌더 — 토스 콘솔 가이드 'TOSS' 가 1순위.
// 다른 후보는 fallback (혹시 환경별로 다를 경우 대비).
function buildAadCandidates(info: Record<string, unknown>): {
  label: string
  aad: Uint8Array | null
}[] {
  const enc = new TextEncoder()
  const list: { label: string; aad: Uint8Array | null }[] = [
    // 토스 콘솔 가이드 명시값
    { label: 'TOSS', aad: enc.encode('TOSS') },
    // 이하 fallback
    { label: 'none', aad: null },
    { label: 'secretKey', aad: b64ToBytes(TOSS_DECRYPT_KEY) },
  ]
  const stringFields = ['userKey', 'sessionKey', 'scope', 'ci', 'di']
  for (const k of stringFields) {
    const v = info[k]
    if (typeof v === 'string' && v.length > 0) {
      list.push({ label: `${k}-utf8`, aad: enc.encode(v) })
      try {
        list.push({ label: `${k}-b64`, aad: b64ToBytes(v) })
      } catch {
        // base64 아닌 값
      }
    }
  }
  list.push({ label: 'empty-string', aad: enc.encode('') })
  return list
}

/**
 * 토스 login-me 응답 PII 필드 복호화.
 * envelope = [12B IV][ciphertext][16B authTag] base64.
 * AAD 후보를 순차 시도 → 첫 성공 후 같은 응답의 나머지 필드는 같은 AAD 로.
 */
async function decryptTossField(
  value: string,
  preferredAad: Uint8Array | null | undefined,
  aadCandidates: { label: string; aad: Uint8Array | null }[],
): Promise<{ plain: string; aad: Uint8Array | null; aadLabel: string } | null> {
  const key = await getDecryptKey()
  if (!key) return null
  let buf: Uint8Array
  try {
    buf = b64ToBytes(value)
  } catch {
    return null
  }
  if (buf.byteLength < 12 + 16 + 1) return null
  const iv = buf.slice(0, 12)
  const ctWithTag = buf.slice(12)

  // preferredAad 가 있으면 (이전 필드에서 성공) 그것만 시도
  const tryList = preferredAad !== undefined
    ? [{ label: 'preferred', aad: preferredAad }]
    : aadCandidates

  for (const c of tryList) {
    try {
      const params: AesGcmParams = { name: 'AES-GCM', iv }
      if (c.aad) params.additionalData = c.aad
      const plain = await crypto.subtle.decrypt(params, key, ctWithTag)
      return {
        plain: new TextDecoder().decode(plain),
        aad: c.aad,
        aadLabel: c.label,
      }
    } catch {
      // 다음 후보 시도
    }
  }
  return null
}

/**
 * info 의 지정 필드를 in-place 복호화.
 * 첫 필드에서 성공한 AAD 를 캐시해 같은 응답의 나머지 필드에 재사용.
 */
async function decryptInPlace(
  info: Record<string, unknown>,
  fields: readonly string[],
): Promise<void> {
  const aadCandidates = buildAadCandidates(info)
  let confirmedAad: Uint8Array | null | undefined = undefined
  for (const k of fields) {
    const v = info[k]
    if (typeof v !== 'string' || v.length === 0) continue
    const result = await decryptTossField(v, confirmedAad, aadCandidates)
    if (result) {
      info[k] = result.plain
      if (confirmedAad === undefined) {
        confirmedAad = result.aad
      }
    } else {
      console.warn(`[toss-auth] decrypt ${k} failed — all AAD candidates exhausted`)
    }
  }
}

// loginMe 응답에서 userKey 추출 (토스 응답 키 이름이 환경마다 다를 수 있어 여러 후보 시도)
function extractUserKey(info: Record<string, unknown>): string | null {
  const candidates = ['userKey', 'userHashKey', 'user_key', 'userKeyForApp']
  for (const k of candidates) {
    const v = info[k]
    if (typeof v === 'string' && v.length > 0) return v
    if (typeof v === 'number') return String(v)
  }
  return null
}

function extractGender(info: Record<string, unknown>): 'M' | 'F' | 'undisclosed' {
  // 토스 응답 키 후보 + 토스 자체 코드 / 영문 풀네임 / 한글 모두 대응
  const candidates = ['gender', 'sex', 'genderCode', 'GENDER']
  for (const k of candidates) {
    const v = info[k]
    if (typeof v === 'string') {
      const norm = v.trim().toUpperCase()
      if (
        norm === 'MALE' ||
        norm === 'M' ||
        norm === '1' ||
        norm === 'MAN' ||
        norm === '남' ||
        norm === '남자'
      ) {
        return 'M'
      }
      if (
        norm === 'FEMALE' ||
        norm === 'F' ||
        norm === '2' ||
        norm === 'WOMAN' ||
        norm === '여' ||
        norm === '여자'
      ) {
        return 'F'
      }
    }
    if (typeof v === 'number') {
      if (v === 1) return 'M'
      if (v === 2) return 'F'
    }
  }
  return 'undisclosed'
}

function extractAgeBucket(info: Record<string, unknown>): 'age_20s' | 'age_30s' | 'age_40plus' | 'undisclosed' {
  // 토스 응답 키 후보: birthday(YYYY-MM-DD) / birthDate / birthYear / dateOfBirth / age
  // 일부 응답은 만나이(age) 정수로 옴
  const ageCandidates = ['age', 'currentAge']
  for (const k of ageCandidates) {
    const v = info[k]
    if (typeof v === 'number' && v > 0 && v < 150) return ageToBucket(v)
    if (typeof v === 'string' && /^\d+$/.test(v)) return ageToBucket(parseInt(v, 10))
  }

  // birthday/birthYear 추출 → 만나이 계산
  const birthYearCandidates = ['birthYear', 'birthYearNumber']
  for (const k of birthYearCandidates) {
    const v = info[k]
    if (typeof v === 'number' && v >= 1900 && v <= 2100) return birthYearToBucket(v)
    if (typeof v === 'string' && /^\d{4}$/.test(v)) return birthYearToBucket(parseInt(v, 10))
  }

  const birthdayCandidates = ['birthday', 'birthDate', 'dateOfBirth', 'BIRTHDAY']
  for (const k of birthdayCandidates) {
    const v = info[k]
    if (typeof v === 'string') {
      // YYYY-MM-DD / YYYYMMDD / YYYY/MM/DD 모두 지원
      const m = v.match(/^(\d{4})/)
      if (m) {
        const year = parseInt(m[1], 10)
        if (year >= 1900 && year <= 2100) return birthYearToBucket(year)
      }
    }
  }

  return 'undisclosed'
}

function ageToBucket(age: number): 'age_20s' | 'age_30s' | 'age_40plus' | 'undisclosed' {
  if (age < 20) return 'undisclosed' // 미성년 보호 — 광고/보상 정책 §13-4
  if (age < 30) return 'age_20s'
  if (age < 40) return 'age_30s'
  return 'age_40plus'
}

function birthYearToBucket(year: number): 'age_20s' | 'age_30s' | 'age_40plus' | 'undisclosed' {
  const now = new Date()
  return ageToBucket(now.getFullYear() - year)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') {
    return withCors(new Response('Method Not Allowed', { status: 405 }))
  }

  let authorizationCode: string
  let referrer: Referrer
  try {
    const body = await req.json()
    if (typeof body?.authorizationCode !== 'string' || body.authorizationCode.length === 0) {
      return withCors(
        new Response('Bad Request: authorizationCode required', { status: 400 }),
      )
    }
    authorizationCode = body.authorizationCode
    const r = (body?.referrer as string | undefined) ?? TOSS_REFERRER_FALLBACK
    const normalized = normalizeReferrer(r)
    if (!normalized) {
      return withCors(
        new Response('Bad Request: referrer must be DEFAULT or SANDBOX', { status: 400 }),
      )
    }
    referrer = normalized
  } catch {
    return withCors(new Response('Bad Request: invalid JSON', { status: 400 }))
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  try {
    // 1) code → accessToken
    const { accessToken } = await tossExchangeToken(authorizationCode, referrer)

    // 2) loginMe → userInfo
    const userInfo = await tossLoginMe(accessToken)

    // 응답 PII 필드 복호화 (TOSS_DECRYPT_KEY 정적 키 + AES-256-GCM, IV=앞 12B, tag=뒤 16B)
    // 평문화 후 extractGender/extractAgeBucket 가 그대로 처리.
    await decryptInPlace(userInfo, ['gender', 'birthday', 'name'])

    const userKey = extractUserKey(userInfo)
    if (!userKey) {
      console.error('[toss-auth] userKey missing in loginMe success payload')
      return withCors(
        Response.json({ ok: false, error: 'userKey missing from Toss response' }, { status: 502 }),
      )
    }
    const gender = extractGender(userInfo)
    const ageBucket = extractAgeBucket(userInfo)
    // 운영 디버깅용 — 응답에 어떤 키가 있었는지 / 추출 결과 로그

    // 3) 사용자 upsert (auth.users + public.users)
    //    raw 컬럼에 토스 원본값 저장. effective(gender/age_bucket)는
    //    20260504000006 마이그레이션의 트리거가 *_public 플래그로 자동 동기화
    const syntheticEmail = `toss_${userKey}@${SYNTHETIC_EMAIL_DOMAIN}`

    const { data: existing, error: lookupErr } = await admin
      .from('users')
      .select('id')
      .eq('toss_user_key', userKey)
      .maybeSingle()
    if (lookupErr) throw lookupErr

    let userId: string
    if (existing) {
      userId = existing.id
      const { error: updErr } = await admin
        .from('users')
        .update({
          gender_raw: gender,
          age_bucket_raw: ageBucket,
        })
        .eq('id', userId)
      if (updErr) throw updErr
    } else {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: syntheticEmail,
        email_confirm: true,
        user_metadata: { toss_user_key: userKey },
      })
      if (createErr || !created.user) throw createErr ?? new Error('createUser returned no user')
      userId = created.user.id

      const { error: insErr } = await admin.from('users').insert({
        id: userId,
        toss_user_key: userKey,
        gender_raw: gender,
        age_bucket_raw: ageBucket,
      })
      if (insErr) throw insErr
    }

    // 4) magic link 토큰 발급 → 클라이언트가 verifyOtp로 세션 확립
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: syntheticEmail,
    })
    if (linkErr || !linkData.properties?.hashed_token) {
      throw linkErr ?? new Error('generateLink returned no hashed_token')
    }

    return withCors(
      Response.json({
        ok: true,
        email: syntheticEmail,
        tokenHash: linkData.properties.hashed_token,
      }),
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[toss-auth] error:', msg)
    return withCors(Response.json({ ok: false, error: msg }, { status: 500 }))
  }
})
