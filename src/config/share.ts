const ORIGIN_PATTERN = /^https?:\/\/[^/\s]+$/;

export function getShareUrl(voteId: string): string {
  const fromEnv = import.meta.env.VITE_PUBLIC_HOST as string | undefined;
  const origin =
    fromEnv && ORIGIN_PATTERN.test(fromEnv) ? fromEnv : window.location.origin;
  return `${origin}/vote/${encodeURIComponent(voteId)}`;
}
