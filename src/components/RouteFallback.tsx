import {
  borderWidth,
  controlHeight,
  motion,
  palette,
  radius,
  spacing,
} from "../design/tokens";
import { AppShell } from "./AppShell";

export function RouteFallback() {
  return (
    <AppShell>
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: spacing.xxxl,
        }}
      >
        <div
          aria-hidden
          style={{
            width: controlHeight.spinner,
            height: controlHeight.spinner,
            borderRadius: radius.pill,
            border: `${borderWidth.spinner}px solid ${palette.divider}`,
            borderTopColor: palette.brand,
            animation: `vd-spin ${motion.spinMs}ms linear infinite`,
          }}
        />
      </div>
    </AppShell>
  );
}
