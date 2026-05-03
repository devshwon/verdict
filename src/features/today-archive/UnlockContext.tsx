import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { watchRewardAd } from "../../lib/ads";
import {
  fetchAllUserUnlocks,
  getDailyMissions,
  registerAdWatch,
  unlockVoteResults,
} from "../../lib/db/votes";
import {
  UnlockContext,
  type UnlockOptions,
  type WatchAd,
} from "./unlockContextValue";

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
  const [freePassBalance, setFreePassBalance] = useState(0);
  const controllers = useRef<Map<string, AbortController>>(new Map());
  const hydratedRef = useRef(false);

  const refreshFreePassBalance = useCallback(async () => {
    try {
      const m = await getDailyMissions();
      setFreePassBalance(m.freePassBalance);
    } catch (e) {
      console.error("[UnlockProvider] mission load failed:", e);
    }
  }, []);

  // 마운트 직후 1회: 서버 vote_unlocks 본인 row 전체 fetch + 무료이용권 잔량 hydrate
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const ids = await fetchAllUserUnlocks();
        if (cancelled) return;
        setUnlockedIds((prev) => {
          if (ids.length === 0) return prev;
          const next = new Set(prev);
          for (const id of ids) next.add(id);
          return next;
        });
      } catch (e) {
        console.error("[UnlockProvider] hydrate failed:", e);
      }
    })();
    void refreshFreePassBalance();
    return () => {
      cancelled = true;
    };
  }, [refreshFreePassBalance]);

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
    async (id: string, options: UnlockOptions = {}) => {
      if (controllers.current.has(id) || unlockedIds.has(id)) return;

      const { forceAd = false } = options;
      // 무료이용권 보유 + 강제 광고 모드 아니면 무료이용권으로 즉시 언락
      const useFreePass = !forceAd && freePassBalance > 0;

      const ctrl = new AbortController();
      controllers.current.set(id, ctrl);
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      setLastError(null);

      const timeoutId = useFreePass
        ? null
        : window.setTimeout(() => ctrl.abort(timeoutReason), AD_TIMEOUT_MS);

      try {
        if (useFreePass) {
          const outcome = await unlockVoteResults(id, { useFreePass: true });
          if (ctrl.signal.aborted) return;
          if (!outcome.ok) {
            // 무료이용권 잔량이 race로 사라졌으면 광고 fallback로 자동 재시도
            if (outcome.reason === "free_pass_unavailable") {
              setFreePassBalance(0);
              await runAdUnlock(id, ctrl);
              return;
            }
            setLastError(outcome.message);
            return;
          }
          setFreePassBalance((b) => Math.max(0, b - 1));
          setUnlockedIds((prev) => {
            const next = new Set(prev);
            next.add(id);
            return next;
          });
          return;
        }

        await runAdUnlock(id, ctrl);
      } catch (err) {
        if (ctrl.signal.aborted) {
          if (ctrl.signal.reason === timeoutReason) {
            setLastError("광고 로드 시간이 초과됐어요.");
          }
          return;
        }
        const message =
          err instanceof Error ? err.message : "광고를 불러오지 못했어요.";
        setLastError(message);
      } finally {
        if (timeoutId !== null) window.clearTimeout(timeoutId);
        controllers.current.delete(id);
        setPendingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }

      async function runAdUnlock(voteId: string, controller: AbortController) {
        await watchAd(voteId, controller.signal);
        if (controller.signal.aborted) return;
        const tokenOutcome = await registerAdWatch("unlock_vote_result");
        if (controller.signal.aborted) return;
        if (!tokenOutcome.ok) {
          setLastError(tokenOutcome.message);
          return;
        }
        const outcome = await unlockVoteResults(voteId, {
          adToken: tokenOutcome.adToken,
        });
        if (controller.signal.aborted) return;
        if (!outcome.ok) {
          setLastError(outcome.message);
          return;
        }
        setUnlockedIds((prev) => {
          const next = new Set(prev);
          next.add(voteId);
          return next;
        });
      }
    },
    [freePassBalance, unlockedIds, watchAd]
  );

  useEffect(() => {
    const map = controllers.current;
    return () => {
      for (const ctrl of map.values()) ctrl.abort();
      map.clear();
    };
  }, []);

  const value = useMemo(
    () => ({
      isUnlocked,
      isPending,
      unlock,
      cancel,
      lastError,
      clearError,
      freePassBalance,
    }),
    [
      isUnlocked,
      isPending,
      unlock,
      cancel,
      lastError,
      clearError,
      freePassBalance,
    ]
  );

  return (
    <UnlockContext.Provider value={value}>{children}</UnlockContext.Provider>
  );
}

const timeoutReason = Symbol("ad-timeout");

async function defaultWatchAd(_id: string, signal: AbortSignal) {
  await watchRewardAd({ signal });
}
