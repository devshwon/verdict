import type { CSSProperties } from "react";
import { useEffect, useRef } from "react";

import { AD_GROUP_ID } from "../../config/ads";
import { useTossBanner } from "./useTossBanner";

interface BannerAdProps {
  /** 토스 디벨로퍼 센터에서 발급받은 adGroupId. 미지정 시 config 기본값 사용 */
  adGroupId?: string;
  /** 컨테이너 스타일 (높이는 기본 96px) */
  style?: CSSProperties;
  className?: string;
}

/**
 * Apps in Toss 배너 광고.
 * SDK 초기화 후 컨테이너 div에 배너를 부착.
 */
export function BannerAd({
  adGroupId = AD_GROUP_ID.banner,
  style,
  className,
}: BannerAdProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { isInitialized, attachBanner } = useTossBanner();

  useEffect(() => {
    if (!isInitialized || !containerRef.current) return;

    const attached = attachBanner(adGroupId, containerRef.current, {
      theme: "auto",
      tone: "blackAndWhite",
      variant: "expanded",
    });

    return () => {
      attached?.destroy();
    };
  }, [isInitialized, adGroupId, attachBanner]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: "100%", minHeight: 96, ...style }}
    />
  );
}
