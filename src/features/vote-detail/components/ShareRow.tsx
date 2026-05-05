import { Button } from "@toss/tds-mobile";
import {
  fontSize,
  fontWeight,
  palette,
  spacing,
} from "../../../design/tokens";

// 카카오톡/인스타그램 공유는 추후 지원 예정 — 현재는 토스 공유 링크 복사만 노출
type Channel = "url";
// type Channel = "kakao" | "instagram" | "url";

type Props = {
  pendingChannel?: Channel | null;
  onShare: (channel: Channel) => void;
};

const channels: { key: Channel; label: string; ready: boolean }[] = [
  // { key: "kakao", label: "카카오톡", ready: false },
  // { key: "instagram", label: "인스타그램", ready: false },
  { key: "url", label: "링크 복사", ready: true },
];

export function ShareRow({ pendingChannel, onShare }: Props) {
  return (
    <section
      style={{
        margin: `${spacing.md}px ${spacing.lg}px`,
        display: "flex",
        flexDirection: "column",
        gap: spacing.sm,
      }}
    >
      <span
        style={{
          fontSize: fontSize.label,
          fontWeight: fontWeight.medium,
          color: palette.textSecondary,
        }}
      >
        결과 공유하기
      </span>
      <div style={{ display: "flex", gap: spacing.sm }}>
        {channels.map((c) => {
          const isPending = pendingChannel === c.key;
          return (
            <div key={c.key} style={{ flex: 1 }}>
              <Button
                size="medium"
                display="full"
                variant="weak"
                color="dark"
                disabled={!c.ready || isPending}
                onClick={() => onShare(c.key)}
              >
                {c.ready ? c.label : `${c.label} (준비중)`}
              </Button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
