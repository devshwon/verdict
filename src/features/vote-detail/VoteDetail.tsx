import { Toast } from "@toss/tds-mobile";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { AppShell } from "../../components/AppShell";
import { Pill } from "../../components/Pill";
import { getShareUrl } from "../../config/share";
import {
  categories,
  categoryColors,
  fontSize,
  fontWeight,
  lineHeight,
  motion,
  palette,
  spacing,
} from "../../design/tokens";
import { AdSlot } from "./components/AdSlot";
import { DemographicGroup } from "./components/DemographicGroup";
import { DetailHeader } from "./components/DetailHeader";
import { NotFound } from "./components/NotFound";
import { OverallResult } from "./components/OverallResult";
import { ResultSkeleton } from "./components/ResultSkeleton";
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

  const submittingRef = useRef(false);

  useEffect(() => {
    setPhase(detail?.isClosed ? "result" : "unvoted");
    setMyOptionId(null);
    submittingRef.current = false;
  }, [id, detail?.isClosed]);

  useEffect(() => {
    if (phase !== "submitting") return;
    const t = setTimeout(() => {
      submittingRef.current = false;
      setPhase("result");
    }, motion.resultDelayMs);
    return () => clearTimeout(t);
  }, [phase]);

  if (!detail) {
    return <NotFound onHome={() => navigate("/", { replace: true })} />;
  }

  const accent = categoryColors[detail.category];
  const categoryLabel =
    categories.find((c) => c.key === detail.category)?.label ?? "";

  const handlePick = (optionId: string) => {
    if (submittingRef.current) return;
    if (myOptionId !== null || phase !== "unvoted") return;
    submittingRef.current = true;
    setMyOptionId(optionId);
    setPhase("submitting");
  };

  const handleBack = () => {
    if (location.key === "default") navigate("/", { replace: true });
    else navigate(-1);
  };

  const handleShare = async (channel: ShareChannel) => {
    if (pendingChannel !== null) return;
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
    <AppShell hideBottomNav>
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

      <div style={{ height: spacing.xxl }} aria-hidden />

      {toast !== null ? (
        <Toast
          position="bottom"
          open
          text={toast}
          duration={motion.toastMs}
          onClose={() => setToast(null)}
        />
      ) : null}
    </AppShell>
  );
}
