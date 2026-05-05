import { GoogleAdMob } from "@apps-in-toss/web-framework";
import { useCallback, useEffect, useRef, useState } from "react";

import { AD_GROUP_ID } from "../../config/ads";

type Status = "idle" | "loading" | "loaded" | "showing" | "failed";

interface UseRewardAdOptions {
  adGroupId?: string;
  onReward?: (info: { unitType?: string; unitAmount?: number }) => void;
  onDismissed?: () => void;
  onError?: (error: unknown) => void;
}

/**
 * Apps in Toss 리워드 광고를 사용하기 위한 훅.
 *
 * 사용 예:
 *   const reward = useRewardAd({ onReward: () => unlock() });
 *   <button disabled={!reward.canShow} onClick={reward.show}>광고 보기</button>
 */
export function useRewardAd(options: UseRewardAdOptions = {}) {
  const { adGroupId = AD_GROUP_ID.reward, onReward, onDismissed, onError } = options;

  const [status, setStatus] = useState<Status>("idle");
  const cleanupRef = useRef<(() => void) | null>(null);
  const earnedRef = useRef(false);
  const callbacksRef = useRef({ onReward, onDismissed, onError });

  useEffect(() => {
    callbacksRef.current = { onReward, onDismissed, onError };
  }, [onReward, onDismissed, onError]);

  const isSupported = useCallback(() => {
    return (
      GoogleAdMob.loadAppsInTossAdMob.isSupported() === true &&
      GoogleAdMob.showAppsInTossAdMob.isSupported() === true
    );
  }, []);

  const load = useCallback(() => {
    if (!isSupported()) {
      setStatus("failed");
      return;
    }
    if (status === "loading" || status === "loaded") return;

    cleanupRef.current?.();
    setStatus("loading");

    const cleanup = GoogleAdMob.loadAppsInTossAdMob({
      options: { adGroupId },
      onEvent: (event) => {
        if (event.type === "loaded") {
          setStatus("loaded");
        }
      },
      onError: (error) => {
        setStatus("failed");
        callbacksRef.current.onError?.(error);
      },
    });
    cleanupRef.current = cleanup ?? null;
  }, [adGroupId, isSupported, status]);

  const show = useCallback(() => {
    if (!isSupported() || status !== "loaded") return;
    earnedRef.current = false;
    setStatus("showing");

    GoogleAdMob.showAppsInTossAdMob({
      options: { adGroupId },
      onEvent: (event) => {
        switch (event.type) {
          case "userEarnedReward":
            earnedRef.current = true;
            callbacksRef.current.onReward?.({
              unitType: event.data?.unitType,
              unitAmount: event.data?.unitAmount,
            });
            break;
          case "dismissed":
            setStatus("idle");
            callbacksRef.current.onDismissed?.();
            break;
          case "failedToShow":
            setStatus("failed");
            break;
        }
      },
      onError: (error) => {
        setStatus("failed");
        callbacksRef.current.onError?.(error);
      },
    });
  }, [adGroupId, isSupported, status]);

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, []);

  return {
    status,
    isLoaded: status === "loaded",
    isLoading: status === "loading",
    canShow: status === "loaded",
    isSupported: isSupported(),
    load,
    show,
  };
}
