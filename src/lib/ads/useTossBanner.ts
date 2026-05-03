import {
  TossAds,
  type TossAdsAttachBannerOptions,
  type TossAdsAttachBannerResult,
} from "@apps-in-toss/web-framework";
import { useCallback, useEffect, useState } from "react";

let initializing = false;
let initialized = false;
const listeners = new Set<(value: boolean) => void>();

function notify(value: boolean) {
  initialized = value;
  listeners.forEach((cb) => cb(value));
}

/**
 * TossAds SDK 초기화 + 배너 부착 헬퍼.
 * 앱 어디에서나 호출 가능하며, SDK 초기화는 한 번만 일어남.
 */
export function useTossBanner() {
  const [isInitialized, setIsInitialized] = useState(initialized);

  useEffect(() => {
    listeners.add(setIsInitialized);
    return () => {
      listeners.delete(setIsInitialized);
    };
  }, []);

  useEffect(() => {
    if (initialized || initializing) return;
    if (!TossAds.initialize.isSupported()) {
      console.warn("[ads] TossAds not supported in this environment");
      return;
    }
    initializing = true;
    TossAds.initialize({
      callbacks: {
        onInitialized: () => {
          initializing = false;
          notify(true);
        },
        onInitializationFailed: (error) => {
          initializing = false;
          console.error("[ads] TossAds init failed", error);
        },
      },
    });
  }, []);

  const attachBanner = useCallback(
    (
      adGroupId: string,
      element: HTMLElement,
      options?: TossAdsAttachBannerOptions,
    ): TossAdsAttachBannerResult | undefined => {
      if (!initialized) return undefined;
      return TossAds.attachBanner(adGroupId, element, options);
    },
    [],
  );

  return { isInitialized, attachBanner };
}
