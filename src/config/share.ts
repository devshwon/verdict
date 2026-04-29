export function getShareUrl(voteId: string): string {
  const fromEnv = import.meta.env.VITE_PUBLIC_HOST as string | undefined;
  const origin = fromEnv && fromEnv.length > 0 ? fromEnv : window.location.origin;
  return `${origin}/vote/${voteId}`;
}
