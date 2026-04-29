import { Button, Toast } from "@toss/tds-mobile";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { getShareUrl } from "../../config/share";
import {
  borderWidth,
  categories,
  categoryColors,
  controlHeight,
  fontSize,
  fontWeight,
  layout,
  lineHeight,
  motion,
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
type ShareChannel = "kakao" | "instagram" | "url";

export function VoteDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const detail = useMemo(() => getVoteDetail(id), [id]);

  const [phase, setPhase] = useState<Phase>(() =>
    detail?.isClosed ? "result" : "unvoted",
  );
  const [myOptionId, setMyOptionId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pendingChannel, setPendingChannel] = useState<ShareChannel | null>(
    null,
  );

  useEffect(() => {
    setPhase(detail?.isClosed ? "result" : "unvoted");
    setMyOptionId(null);
  }, [id, detail?.isClosed]);

  useEffect(() => {
    if (phase !== "submitting") return;
    const t = setTimeout(() => setPhase("result"), motion.resultDelayMs);
    return () => clearTimeout(t);
  }, [phase]);

  if (!detail) {
    return <NotFound onHome={() => navigate("/", { replace: true })} />;
  }

  const accent = categoryColors[detail.category];
  const categoryLabel =
    categories.find((c) => c.key === detail.category)?.label ?? "";

  const handlePick = (optionId: string) => {
    if (myOptionId !== null || phase !== "unvoted") return;
    setMyOptionId(optionId);
    setPhase("submitting");
  };

  const handleBack = () => {
    if (location.key === "default") navigate("/", { replace: true });
    else navigate(-1);
  };

  const handleShare = async (channel: ShareChannel) => {
    if (pendingChannel === channel) return;
    setPendingChannel(channel);
    try {
      if (channel === "url") {
        try {
          await navigator.clipboard.writeText(getShareUrl(detail.id));
          setToast("링크가 복사됐어요");
        } catch {
          setToast("복사에 실패했어요");
        }
        return;
      }
      const label = channel === "kakao" ? "카카오톡" : "인스타그램";
      setToast(`${label} 공유는 곧 지원될 예정이에요`);
    } finally {
      setTimeout(() => {
        setPendingChannel((prev) => (prev === channel ? null : prev));
      }, motion.toastMs);
    }
  };

  return (
    <div
      style={{
        background: palette.surface,
        minHeight: "100vh",
        paddingBottom: spacing.xxl,
      }}
    >
      <DetailHeader onBack={handleBack} />

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
            fontSize: fontSize.heading,
            fontWeight: fontWeight.bold,
            lineHeight: lineHeight.tight,
            color: palette.textPrimary,
          }}
        >
          “{detail.question}”
        </h1>
        <div
          style={{
            display: "flex",
            gap: spacing.md,
            fontSize: fontSize.label,
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
            disabled={myOptionId !== null}
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
          <ShareRow pendingChannel={pendingChannel} onShare={handleShare} />
        </>
      ) : null}

      {toast !== null ? (
        <Toast
          position="bottom"
          open
          text={toast}
          duration={motion.toastMs}
          onClose={() => setToast(null)}
        />
      ) : null}
    </div>
  );
}

function DetailHeader({ onBack }: { onBack: () => void }) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        height: controlHeight.header,
        padding: `0 ${spacing.sm}px`,
      }}
    >
      <button
        type="button"
        onClick={onBack}
        aria-label="뒤로가기"
        style={{
          width: controlHeight.iconButton,
          height: controlHeight.iconButton,
          borderRadius: radius.pill,
          border: "none",
          background: "transparent",
          color: palette.textPrimary,
          fontSize: fontSize.hero,
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
        border: `${borderWidth.hairline}px solid ${palette.border}`,
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
            fontSize: fontSize.subtitle,
            fontWeight: fontWeight.bold,
            color: palette.textPrimary,
          }}
        >
          전체 결과
        </h3>
        {isClosed && !myOptionId ? (
          <span
            style={{ fontSize: fontSize.small, color: palette.textSecondary }}
          >
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
            labelWidth={layout.resultLabelMd}
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
        fontSize: fontSize.label,
      }}
    >
      <div
        aria-hidden
        style={{
          width: controlHeight.spinner,
          height: controlHeight.spinner,
          borderRadius: radius.pill,
          border: `${borderWidth.spinner}px solid ${palette.divider}`,
          borderTopColor: accentBar,
          animation: `vd-spin ${motion.spinMs}ms linear infinite`,
        }}
      />
      결과 집계 중…
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
        fontSize: fontSize.caption,
        fontWeight: fontWeight.medium,
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

function NotFound({ onHome }: { onHome: () => void }) {
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
      <span
        style={{
          fontSize: fontSize.title,
          fontWeight: fontWeight.bold,
          color: palette.textPrimary,
        }}
      >
        투표를 찾을 수 없어요
      </span>
      <span style={{ fontSize: fontSize.label, color: palette.textSecondary }}>
        잘못된 링크이거나 삭제된 투표일 수 있어요
      </span>
      <div style={{ marginTop: spacing.sm }}>
        <Button size="medium" variant="fill" color="primary" onClick={onHome}>
          홈으로
        </Button>
      </div>
    </div>
  );
}
