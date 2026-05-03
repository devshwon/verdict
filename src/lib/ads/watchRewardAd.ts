import { GoogleAdMob } from "@apps-in-toss/web-framework";

import { AD_GROUP_ID } from "../../config/ads";

interface WatchRewardAdOptions {
  adGroupId?: string;
  signal?: AbortSignal;
}

/**
 * Apps in Toss 리워드 광고를 1회 시청하고 보상이 지급되면 resolve.
 * - load → show 순으로 진행
 * - 'userEarnedReward' 시 resolve
 * - dismissed/failedToShow/error/abort 시 reject
 *
 * 주의: SDK 정책상 load는 1회만 가능하므로, 동일 adGroupId 광고를 동시에 호출하지 않는다.
 */
export function watchRewardAd({
  adGroupId = AD_GROUP_ID.reward,
  signal,
}: WatchRewardAdOptions = {}): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }

    if (
      GoogleAdMob.loadAppsInTossAdMob.isSupported() !== true ||
      GoogleAdMob.showAppsInTossAdMob.isSupported() !== true
    ) {
      reject(new Error("리워드 광고가 지원되지 않는 환경이에요."));
      return;
    }

    let settled = false;
    let earned = false;
    let cleanupLoad: (() => void) | undefined;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanupLoad?.();
      signal?.removeEventListener("abort", onAbort);
      fn();
    };

    const onAbort = () => {
      finish(() => reject(new DOMException("aborted", "AbortError")));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    cleanupLoad = GoogleAdMob.loadAppsInTossAdMob({
      options: { adGroupId },
      onEvent: (event) => {
        if (event.type !== "loaded") return;
        cleanupLoad?.();
        cleanupLoad = undefined;

        if (signal?.aborted) {
          finish(() => reject(new DOMException("aborted", "AbortError")));
          return;
        }

        GoogleAdMob.showAppsInTossAdMob({
          options: { adGroupId },
          onEvent: (showEvent) => {
            switch (showEvent.type) {
              case "userEarnedReward":
                earned = true;
                finish(() => resolve());
                break;
              case "dismissed":
                if (!earned) {
                  finish(() =>
                    reject(new Error("광고 시청이 완료되지 않았어요."))
                  );
                }
                break;
              case "failedToShow":
                finish(() => reject(new Error("광고를 보여주지 못했어요.")));
                break;
            }
          },
          onError: (error) => {
            finish(() => reject(error));
          },
        });
      },
      onError: (error) => {
        finish(() => reject(error));
      },
    });
  });
}
