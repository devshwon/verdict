import type { ReactNode } from "react";
import { fontSize, fontWeight, palette, spacing } from "../../../design/tokens";

type Props = {
  title: string;
  subtitle?: string;
  errorMessage?: string;
  children: ReactNode;
};

export function FormSection({ title, subtitle, errorMessage, children }: Props) {
  return (
    <div style={{ padding: `${spacing.xl}px ${spacing.lg}px 0` }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: spacing.sm,
          marginBottom: spacing.md,
        }}
      >
        <span
          style={{
            fontSize: fontSize.subtitle,
            fontWeight: fontWeight.medium,
            color: palette.textPrimary,
          }}
        >
          {title}
        </span>
        {subtitle ? (
          <span
            style={{
              fontSize: fontSize.small,
              color: palette.textTertiary,
            }}
          >
            {subtitle}
          </span>
        ) : null}
      </div>
      {children}
      {errorMessage ? (
        <div
          role="alert"
          style={{
            marginTop: spacing.sm,
            fontSize: fontSize.small,
            color: "#D03A3A",
          }}
        >
          {errorMessage}
        </div>
      ) : null}
    </div>
  );
}
