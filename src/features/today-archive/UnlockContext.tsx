import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { UnlockContext, type WatchAd } from "./unlockContextValue";

const AD_TIMEOUT_MS = 15_000;

type Props = {
  children: ReactNode;
  initialUnlockedIds?: string[];
  watchAd?: WatchAd;
};

export function UnlockProvider({
  children,
  initialUnlockedIds = [],
  watchAd = defaultWatchAd,
}: Props) {
  const [unlockedIds, setUnlockedIds] = useState<Set<string>>(
    () => new Set(initialUnlockedIds)
  );
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
  const [lastError, setLastError] = useState<string | null>(null);
  const controllers = useRef<Map<string, AbortController>>(new Map());

  const isUnlocked = useCallback(
    (id: string) => unlockedIds.has(id),
    [unlockedIds]
  );
  const isPending = useCallback(
    (id: string) => pendingIds.has(id),
    [pendingIds]
  );

  const clearError = useCallback(() => setLastError(null), []);

  const cancel = useCallback((id: string) => {
    const ctrl = controllers.current.get(id);
    if (ctrl) ctrl.abort();
  }, []);

  const unlock = useCallback(
    async (id: string) => {
      if (controllers.current.has(id) || unlockedIds.has(id)) return;

      const ctrl = new AbortController();
      controllers.current.set(id, ctrl);
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      setLastError(null);

      const timeoutId = window.setTimeout(() => ctrl.abort(timeoutReason), AD_TIMEOUT_MS);

      try {
        await watchAd(id, ctrl.signal);
        if (ctrl.signal.aborted) return;
        setUnlockedIds((prev) => {
          const next = new Set(prev);
          next.add(id);
          return next;
        });
      } catch (err) {
        if (ctrl.signal.aborted) {
          // 사용자 취소(언마운트 등)는 조용히 종료. 타임아웃은 reason으로 식별.
          if (ctrl.signal.reason === timeoutReason) {
            setLastError("광고 로드 시간이 초과됐어요.");
          }
          return;
        }
        const message =
          err instanceof Error ? err.message : "광고를 불러오지 못했어요.";
        setLastError(message);
      } finally {
        window.clearTimeout(timeoutId);
        controllers.current.delete(id);
        setPendingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [unlockedIds, watchAd]
  );

  useEffect(() => {
    const map = controllers.current;
    return () => {
      for (const ctrl of map.values()) ctrl.abort();
      map.clear();
    };
  }, []);

  const value = useMemo(
    () => ({ isUnlocked, isPending, unlock, cancel, lastError, clearError }),
    [isUnlocked, isPending, unlock, cancel, lastError, clearError]
  );

  return (
    <UnlockContext.Provider value={value}>{children}</UnlockContext.Provider>
  );
}

const timeoutReason = Symbol("ad-timeout");

async function defaultWatchAd(_id: string, signal: AbortSignal) {
  // 실제 광고 SDK 연동 자리. signal.aborted를 SDK dispose에 연결할 것.
  await new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    const t = window.setTimeout(resolve, 800);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(t);
        reject(new DOMException("aborted", "AbortError"));
      },
      { once: true }
    );
  });
}
