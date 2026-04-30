import { Button, Toast } from "@toss/tds-mobile";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { AppShell } from "../../components/AppShell";
import { Pill } from "../../components/Pill";
import { getShareUrl } from "../../config/share";
import {
  borderWidth,
  categories,
  categoryColors,
  fontSize,
  fontWeight,
  lineHeight,
  motion,
  palette,
  radius,
  spacing,
} from "../../design/tokens";
import {
  castVote,
  fetchVoteDetail,
  registerAdWatch,
  unlockVoteResults,
} from "../../lib/db/votes";
import { AdSlot } from "./components/AdSlot";
import { DemographicGroup } from "./components/DemographicGroup";
import { DetailHeader } from "./components/DetailHeader";
import { NotFound } from "./components/NotFound";
import { OverallResult } from "./components/OverallResult";
import { ResultSkeleton } from "./components/ResultSkeleton";
import { ShareRow } from "./components/ShareRow";
import { VoteOptions } from "./components/VoteOptions";
import type { VoteDetail as VoteDetailType } from "./types";

type Phase =
  | "loading"
  | "missing"
  | "unvoted"
  | "submitting"
  | "ad_gate"
  | "watching_ad"
  | "result";
type ShareChannel = "kakao" | "instagram" | "url";

// 임시 시뮬레이션 광고 — 실제 앱인토스 리워드 SDK 연동은 5번(TodayArchive)에서 처리
const SIMULATED_AD_MS = 1500;

export function VoteDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const [detail, setDetail] = useState<VoteDetailType | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [myOptionId, setMyOptionId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pendingChannel, setPendingChannel] = useState<ShareChannel | null>(
    null,
  );

  const submittingRef = useRef(false);

  const load = useCallback(async () => {
    if (!id) {
      setPhase("missing");
      return;
    }
    try {
      const res = await fetchVoteDetail(id);
      if (!res) {
        setDetail(null);
        setPhase("missing");
        return;
      }
      setDetail(res.detail);
      setMyOptionId(res.myOptionId);
      if (!res.detail.isClosed && res.myOptionId === null) {
        setPhase("unvoted");
      } else if (res.myOptionId !== null || res.hasUnlock) {
        setPhase("result");
      } else {
        // 마감 + 미참여 + 미언락 → 광고 게이트
        setPhase("ad_gate");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[VoteDetail] load failed:", msg);
      setToast(msg);
      setPhase("missing");
    }
  }, [id]);

  useEffect(() => {
    submittingRef.current = false;
    void load();
  }, [load]);

  if (phase === "loading") {
    return (
      <AppShell hideBottomNav>
        <DetailHeader onBack={() => navigate(-1)} />
        <div
          style={{
            margin: `${spacing.xl}px ${spacing.lg}px`,
            color: palette.textSecondary,
            fontSize: fontSize.body,
            textAlign: "center",
          }}
        >
          불러오는 중…
        </div>
      </AppShell>
    );
  }

  if (phase === "missing" || !detail) {
    return <NotFound onHome={() => navigate("/", { replace: true })} />;
  }

  const accent = categoryColors[detail.category];
  const categoryLabel =
    categories.find((c) => c.key === detail.category)?.label ?? "";

  const handlePick = async (optionId: string) => {
    if (submittingRef.current) return;
    if (myOptionId !== null || phase !== "unvoted") return;
    submittingRef.current = true;
    setPhase("submitting");
    const result = await castVote(detail.id, optionId);
    if (!result.ok) {
      submittingRef.current = false;
      setToast(result.message);
      if (result.reason === "already_voted" || result.reason === "closed") {
        await load();
      } else {
        setPhase("unvoted");
      }
      return;
    }
    setMyOptionId(optionId);
    // 결과 연출: 짧은 딜레이 후 reload하여 최신 결과 반영
    setTimeout(async () => {
      await load();
      submittingRef.current = false;
    }, motion.resultDelayMs);
  };

  const handleWatchAd = async () => {
    if (phase !== "ad_gate" || !detail) return;
    setPhase("watching_ad");
    try {
      // TODO: 실제 앱인토스 리워드 광고 SDK 시청 콜백으로 대체
      await new Promise((r) => setTimeout(r, SIMULATED_AD_MS));
      const tokenOutcome = await registerAdWatch("unlock_vote_result");
      if (!tokenOutcome.ok) {
        setToast(tokenOutcome.message);
        setPhase("ad_gate");
        return;
      }
      await unlockVoteResults(detail.id, tokenOutcome.adToken);
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[VoteDetail] unlock failed:", msg);
      setToast("광고 시청에 실패했어요. 다시 시도해주세요");
      setPhase("ad_gate");
    }
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

      {phase === "ad_gate" || phase === "watching_ad" ? (
        <AdGate
          watching={phase === "watching_ad"}
          onWatch={handleWatchAd}
          onHome={() => navigate("/", { replace: true })}
          accentBar={accent.bar}
        />
      ) : null}

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

function AdGate({
  watching,
  onWatch,
  onHome,
  accentBar,
}: {
  watching: boolean;
  onWatch: () => void;
  onHome: () => void;
  accentBar: string;
}) {
  return (
    <section
      style={{
        margin: `${spacing.lg}px ${spacing.lg}px 0`,
        padding: spacing.xl,
        borderRadius: radius.lg,
        border: `${borderWidth.hairline}px solid ${palette.border}`,
        background: palette.surface,
        display: "flex",
        flexDirection: "column",
        gap: spacing.md,
        alignItems: "stretch",
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: fontSize.title,
          fontWeight: fontWeight.bold,
          color: palette.textPrimary,
          lineHeight: lineHeight.tight,
        }}
      >
        투표가 종료됐어요
      </p>
      <p
        style={{
          margin: 0,
          fontSize: fontSize.body,
          color: palette.textSecondary,
          lineHeight: lineHeight.body,
        }}
      >
        결과를 보려면 광고를 시청해주세요.
      </p>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: spacing.sm,
          marginTop: spacing.xs,
        }}
      >
        <Button
          size="medium"
          variant="fill"
          color="primary"
          disabled={watching}
          onClick={onWatch}
        >
          {watching ? "광고 시청 중…" : "광고 보고 결과 확인하기"}
        </Button>
        <Button
          size="medium"
          variant="weak"
          color="dark"
          disabled={watching}
          onClick={onHome}
        >
          홈으로 돌아가기
        </Button>
      </div>
      <span
        aria-hidden
        style={{
          height: 2,
          background: accentBar,
          opacity: 0.15,
          borderRadius: radius.sm,
        }}
      />
    </section>
  );
}
