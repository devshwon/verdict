import { createContext, useContext } from "react";

export type WatchAd = (id: string, signal: AbortSignal) => Promise<void>;

export type UnlockOptions = {
  /** true면 무료이용권 잔량과 무관하게 광고 시청 강제 */
  forceAd?: boolean;
};

export type UnlockState = {
  isUnlocked: (id: string) => boolean;
  isPending: (id: string) => boolean;
  unlock: (id: string, options?: UnlockOptions) => Promise<void>;
  cancel: (id: string) => void;
  lastError: string | null;
  clearError: () => void;
  /** 현재 무료이용권 잔량. 0이면 광고 시청만 가능 */
  freePassBalance: number;
};

export const UnlockContext = createContext<UnlockState | null>(null);

export function useUnlock(): UnlockState {
  const ctx = useContext(UnlockContext);
  if (!ctx) throw new Error("UnlockProvider 안에서만 사용할 수 있어요.");
  return ctx;
}
