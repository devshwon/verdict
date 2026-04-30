import { createContext, useContext } from "react";

export type WatchAd = (id: string, signal: AbortSignal) => Promise<void>;

export type UnlockState = {
  isUnlocked: (id: string) => boolean;
  isPending: (id: string) => boolean;
  unlock: (id: string) => Promise<void>;
  cancel: (id: string) => void;
  lastError: string | null;
  clearError: () => void;
};

export const UnlockContext = createContext<UnlockState | null>(null);

export function useUnlock(): UnlockState {
  const ctx = useContext(UnlockContext);
  if (!ctx) throw new Error("UnlockProvider 안에서만 사용할 수 있어요.");
  return ctx;
}
