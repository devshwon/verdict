import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  categories,
  categoryColors,
  palette,
  radius,
  spacing,
} from "../../design/tokens";
import { AdSlot } from "./components/AdSlot";
import { DemographicGroup } from "./components/DemographicGroup";
import { ResultBar } from "./components/ResultBar";
import { ShareRow } from "./components/ShareRow";
import { VoteOptions } from "./components/VoteOptions";
import { getVoteDetail } from "./mocks";

type Phase = "unvoted" | "submitting" | "result";

const RESULT_DELAY_MS = 800;

export function VoteDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const detail = useMemo(() => getVoteDetail(id), [id]);

  const [phase, setPhase] = useState<Phase>(() =>
    detail?.isClosed ? "result" : "unvoted",
  );
  const [myOptionId, setMyOptionId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (phase !== "submitting") return;
    const t = setTimeout(() => setPhase("result"), RESULT_DELAY_MS);
    return () => clearTimeout(t);
  }, [phase]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(t);
  }, [toast]);

  if (!detail) {
    return <NotFound onBack={() => navigate("/")} />;
  }

  const accent = categoryColors[detail.category];
  const categoryLabel =
    categories.find((c) => c.key === detail.category)?.label ?? "";

  const handlePick = (optionId: string) => {
    setMyOptionId(optionId);
    setPhase("submitting");
  };

  const handleShare = (channel: "kakao" | "instagram" | "url") => {
    if (channel === "url") {
      const url = `${window.location.origin}/vote/${detail.id}`;
      try {
        navigator.clipboard?.writeText(url);
      } catch {
        // ignore — dummy mode
      }
      setToast("링크가 복사됐어요");
      return;
    }
    const label = channel === "kakao" ? "카카오톡" : "인스타그램";
    setToast(`${label} 공유는 곧 지원될 예정이에요`);
  };

  return (
    <div
      style={{
        background: palette.surface,
        minHeight: "100vh",
        paddingBottom: spacing.xxl,
      }}
    >
      <DetailHeader onBack={() => navigate(-1)} />

      <section
        style={{
          margin: `${spacing.md}px ${spacing.lg}px ${spacing.lg}px`,
          display: "flex",
          flexDirection: "column",
          gap: spacing.sm,
        }}
      >
        <div style={{ display: "flex", gap: spacing.xs }}>
          <Pill bg={accent.surface} fg={accent.text}>
            {categoryLabel}
          </Pill>
          {detail.isClosed ? (
            <Pill bg={palette.divider} fg={palette.textSecondary}>
              마감
            </Pill>
          ) : null}
        </div>
        <h1
          style={{
            margin: 0,
            fontSize: 20,
            fontWeight: 700,
            lineHeight: 1.4,
            color: palette.textPrimary,
          }}
        >
          “{detail.question}”
        </h1>
        <div
          style={{
            display: "flex",
            gap: spacing.md,
            fontSize: 13,
            color: palette.textSecondary,
          }}
        >
          <span>{detail.participants.toLocaleString()}명 참여</span>
          {!detail.isClosed ? <span>· {detail.remainingLabel}</span> : null}
        </div>
      </section>

      {phase === "unvoted" ? (
        <section style={{ margin: `0 ${spacing.lg}px` }}>
          <VoteOptions
            options={detail.options}
            accent={accent}
            onPick={handlePick}
          />
        </section>
      ) : null}

      {phase === "submitting" ? <ResultSkeleton accentBar={accent.bar} /> : null}

      {phase === "result" ? (
        <>
          <OverallResult
            options={detail.options}
            myOptionId={myOptionId}
            accentBar={accent.bar}
            isClosed={detail.isClosed}
          />
          <DemographicGroup
            title="성별 비교"
            buckets={detail.byGender}
            options={detail.options}
            myOptionId={myOptionId}
            accentBar={accent.bar}
          />
          <DemographicGroup
            title="연령대별 비교"
            buckets={detail.byAge}
            options={detail.options}
            myOptionId={myOptionId}
            accentBar={accent.bar}
          />
          <AdSlot />
          <ShareRow onShare={handleShare} />
        </>
      ) : null}

      {toast ? <Toast message={toast} /> : null}
    </div>
  );
}

function DetailHeader({ onBack }: { onBack: () => void }) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        height: 52,
        padding: `0 ${spacing.sm}px`,
      }}
    >
      <button
        type="button"
        onClick={onBack}
        aria-label="뒤로가기"
        style={{
          width: 40,
          height: 40,
          borderRadius: radius.pill,
          border: "none",
          background: "transparent",
          color: palette.textPrimary,
          fontSize: 22,
          cursor: "pointer",
        }}
      >
        ←
      </button>
    </header>
  );
}

function OverallResult({
  options,
  myOptionId,
  accentBar,
  isClosed,
}: {
  options: { id: string; label: string; ratio: number }[];
  myOptionId: string | null;
  accentBar: string;
  isClosed: boolean;
}) {
  return (
    <section
      style={{
        margin: `${spacing.md}px ${spacing.lg}px`,
        padding: spacing.lg,
        borderRadius: radius.lg,
        background: palette.background,
        border: `1px solid ${palette.border}`,
        display: "flex",
        flexDirection: "column",
        gap: spacing.md,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: 15,
            fontWeight: 700,
            color: palette.textPrimary,
          }}
        >
          전체 결과
        </h3>
        {isClosed && !myOptionId ? (
          <span style={{ fontSize: 12, color: palette.textSecondary }}>
            마감된 투표예요
          </span>
        ) : null}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: spacing.sm }}>
        {options.map((opt) => (
          <ResultBar
            key={opt.id}
            label={opt.label}
            ratio={opt.ratio}
            barColor={myOptionId === opt.id ? accentBar : palette.textTertiary}
            highlighted={myOptionId === opt.id}
            labelWidth={64}
          />
        ))}
      </div>
    </section>
  );
}

function ResultSkeleton({ accentBar }: { accentBar: string }) {
  return (
    <div
      style={{
        margin: `${spacing.xl}px ${spacing.lg}px`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: spacing.sm,
        color: palette.textSecondary,
        fontSize: 13,
      }}
    >
      <div
        aria-hidden
        style={{
          width: 28,
          height: 28,
          borderRadius: radius.pill,
          border: `3px solid ${palette.divider}`,
          borderTopColor: accentBar,
          animation: "spin 700ms linear infinite",
        }}
      />
      결과 집계 중…
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function Pill({
  bg,
  fg,
  children,
}: {
  bg: string;
  fg: string;
  children: React.ReactNode;
}) {
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        padding: `${spacing.xs}px ${spacing.sm}px`,
        borderRadius: radius.sm,
        background: bg,
        color: fg,
      }}
    >
      {children}
    </span>
  );
}

function Toast({ message }: { message: string }) {
  return (
    <div
      role="status"
      style={{
        position: "fixed",
        left: "50%",
        bottom: spacing.xxl,
        transform: "translateX(-50%)",
        padding: `${spacing.md}px ${spacing.lg}px`,
        borderRadius: radius.pill,
        background: palette.textPrimary,
        color: palette.background,
        fontSize: 13,
        fontWeight: 600,
        whiteSpace: "nowrap",
        zIndex: 100,
      }}
    >
      {message}
    </div>
  );
}

function NotFound({ onBack }: { onBack: () => void }) {
  return (
    <div
      style={{
        background: palette.surface,
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: spacing.md,
        padding: spacing.xl,
        textAlign: "center",
      }}
    >
      <span style={{ fontSize: 17, fontWeight: 700, color: palette.textPrimary }}>
        투표를 찾을 수 없어요
      </span>
      <span style={{ fontSize: 13, color: palette.textSecondary }}>
        잘못된 링크이거나 삭제된 투표일 수 있어요
      </span>
      <button
        type="button"
        onClick={onBack}
        style={{
          marginTop: spacing.sm,
          padding: `${spacing.md}px ${spacing.xl}px`,
          borderRadius: radius.md,
          border: "none",
          background: palette.brand,
          color: palette.background,
          fontSize: 14,
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        홈으로
      </button>
    </div>
  );
}
