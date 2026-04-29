import { appLogin } from "@apps-in-toss/web-framework";
import { supabase } from "./supabase";

interface TossAuthResponse {
  ok: boolean;
  email?: string;
  tokenHash?: string;
  error?: string;
}

/**
 * 토스 로그인 → Supabase 세션 확립.
 * 1. appLogin()으로 토스에서 인가 코드 획득
 * 2. toss-auth Edge Function 호출 → magic link 토큰 수신
 * 3. verifyOtp로 Supabase 세션 활성화
 */
export async function loginWithToss(): Promise<void> {
  const { authorizationCode, referrer } = await appLogin();

  const { data, error } = await supabase.functions.invoke<TossAuthResponse>(
    "toss-auth",
    { body: { authorizationCode, referrer } },
  );

  if (error) throw error;
  if (!data?.ok || !data.tokenHash) {
    throw new Error(data?.error ?? "Toss auth failed");
  }

  const { error: verifyErr } = await supabase.auth.verifyOtp({
    token_hash: data.tokenHash,
    type: "magiclink",
  });
  if (verifyErr) throw verifyErr;
}

/**
 * 현재 Supabase 세션 조회. 없으면 null 반환.
 */
export async function getCurrentSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/**
 * 로그아웃 (Supabase 세션만 정리. 토스 측 연결은 유지)
 */
export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}
