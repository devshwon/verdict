import { getOperationalEnvironment, getTossShareLink } from "@apps-in-toss/web-framework";

const ORIGIN_PATTERN = /^https?:\/\/[^/\s]+$/;

// granite.config.ts 의 appName 과 일치해야 함
const TOSS_APP_NAME = "verdict";

export function getShareUrl(voteId: string): string {
  const fromEnv = import.meta.env.VITE_PUBLIC_HOST as string | undefined;
  const origin =
    fromEnv && ORIGIN_PATTERN.test(fromEnv) ? fromEnv : window.location.origin;
  return `${origin}/vote/${encodeURIComponent(voteId)}`;
}

// 토스 앱 딥링크 경로 — 토스 앱이 실행되며 /vote/:id 로 진입
export function getTossDeepLink(voteId: string): string {
  return `intoss://${TOSS_APP_NAME}/vote/${encodeURIComponent(voteId)}`;
}

// 외부에 공유 가능한 링크 생성
//   - 토스 앱(또는 sandbox) 환경: getTossShareLink 호출 → 토스 공유 링크 (앱 미설치자는 스토어로 폴백)
//   - 그 외(웹 브라우저): 기존 웹 URL 반환
// 호출 실패 시에도 웹 URL 로 폴백.
export async function buildShareableLink(voteId: string): Promise<string> {
  const webUrl = getShareUrl(voteId);
  let inToss = false;
  try {
    inToss = getOperationalEnvironment() === "toss";
  } catch {
    inToss = false;
  }
  if (!inToss) return webUrl;

  try {
    return await getTossShareLink(getTossDeepLink(voteId));
  } catch (e) {
    console.warn("[share] getTossShareLink failed, fallback to web url:", e);
    return webUrl;
  }
}
