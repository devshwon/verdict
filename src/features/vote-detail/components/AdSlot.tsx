import { BannerAd } from "../../../lib/ads";
import { controlHeight, spacing } from "../../../design/tokens";

export function AdSlot() {
  return (
    <div style={{ margin: `${spacing.md}px ${spacing.lg}px` }}>
      <BannerAd style={{ minHeight: controlHeight.ad }} />
    </div>
  );
}
