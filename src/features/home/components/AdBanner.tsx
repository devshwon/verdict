import { BannerAd } from "../../../lib/ads";
import { controlHeight, spacing } from "../../../design/tokens";

export function AdBanner() {
  return (
    <div style={{ margin: `${spacing.sm}px ${spacing.lg}px` }}>
      <BannerAd style={{ minHeight: controlHeight.adBanner }} />
    </div>
  );
}
