import { useEffect } from "react";
import {
  fontSize,
  fontWeight,
  motion,
  palette,
  radius,
  shadow,
  spacing,
  zIndex,
} from "../../design/tokens";
import { useUnlock } from "./unlockContextValue";

export function UnlockErrorToast() {
  const { lastError, clearError } = useUnlock();

  useEffect(() => {
    if (!lastError) return;
    const id = window.setTimeout(clearError, motion.toastMs);
    return () => window.clearTimeout(id);
  }, [lastError, clearError]);

  if (!lastError) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        left: spacing.lg,
        right: spacing.lg,
        bottom: `calc(env(safe-area-inset-bottom) + ${spacing.xxxl}px)`,
        padding: `${spacing.md}px ${spacing.lg}px`,
        borderRadius: radius.md,
        background: palette.textPrimary,
        color: palette.background,
        fontSize: fontSize.label,
        fontWeight: fontWeight.medium,
        textAlign: "center",
        boxShadow: shadow.md,
        zIndex: zIndex.toast,
      }}
    >
      {lastError}
    </div>
  );
}
