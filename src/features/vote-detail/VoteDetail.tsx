import { Button, Toast } from "@toss/tds-mobile";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { AppShell } from "../../components/AppShell";
import { Pill } from "../../components/Pill";
import { ReportDialog } from "../../components/ReportDialog";
import { UnlockConfirmDialog } from "../../components/UnlockConfirmDialog";
import { buildShareableLink } from "../../config/share";
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
import { watchRewardAd } from "../../lib/ads";
import {
  castVote,
  fetchVoteDetail,
  getDailyMissions,
  registerAdWatch,
  reportVote,
  unlockVoteResults,
} from "../../lib/db/votes";
import type { ReportReason } from "../../lib/db/votes";
import { recordMyCast } from "../../lib/voteCache";
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
// 카카오톡/인스타그램 공유는 추후 지원 — 현재는 url(토스 공유 링크 복사)만
type ShareChannel = "url";
// type ShareChannel = "kakao" | "instagram" | "url";

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
  const [freePassBalance, setFreePassBalance] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportPending, setReportPending] = useState(false);

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
      } else if (res.myOptionId !== null || res.hasUnlock || res.isAuthor) {
        // 마감된 본인 작성 투표는 광고/언락 없이 결과 공개 (작성자 권한)
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

  useEffect(() => {
    let cancelled = false;
    void getDailyMissions()
      .then((m) => {
        if (!cancelled) setFreePassBalance(m.freePassBalance);
      })
      .catch((e) => {
        console.error("[VoteDetail] missions load failed:", e);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

    // RPC + 0.8초 연출 + 백그라운드 reload를 병렬 수행하고 셋 다 끝나면 결과 phase로 전환
    const minDelay = new Promise<void>((r) =>
      setTimeout(r, motion.resultDelayMs)
    );
    const cast = castVote(detail.id, optionId);

    const result = await cast;
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
    recordMyCast(detail.id, optionId);

    // 캐스팅 성공 후 백그라운드로 최신 결과 fetch + 0.8초 연출 동기화
    const reload = load();
    await Promise.all([minDelay, reload]);
    submittingRef.current = false;
  };

  const requestUnlock = () => {
    if (phase !== "ad_gate" || !detail) return;
    if (freePassBalance > 0) {
      setConfirmOpen(true);
      return;
    }
    void unlockWithAd();
  };

  const unlockWithFreePass = async () => {
    if (phase !== "ad_gate" || !detail) return;
    setPhase("watching_ad");
    const outcome = await unlockVoteResults(detail.id, { useFreePass: true });
    if (!outcome.ok) {
      // 잔량이 race로 0이면 광고 fallback
      if (outcome.reason === "free_pass_unavailable") {
        setFreePassBalance(0);
        await unlockWithAd();
        return;
      }
      setToast(outcome.message);
      setPhase("ad_gate");
      return;
    }
    setFreePassBalance((b) => Math.max(0, b - 1));
    await load();
  };

  const unlockWithAd = async () => {
    if (!detail) return;
    setPhase("watching_ad");
    try {
      await watchRewardAd();
      const tokenOutcome = await registerAdWatch("unlock_vote_result");
      if (!tokenOutcome.ok) {
        setToast(tokenOutcome.message);
        setPhase("ad_gate");
        return;
      }
      const outcome = await unlockVoteResults(detail.id, {
        adToken: tokenOutcome.adToken,
      });
      if (!outcome.ok) {
        setToast(outcome.message);
        setPhase("ad_gate");
        return;
      }
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

  const handleReportSelect = async (reason: ReportReason) => {
    if (!detail || reportPending) return;
    setReportPending(true);
    try {
      const outcome = await reportVote(detail.id, reason);
      if (!outcome.ok) {
        setToast(outcome.message);
        return;
      }
      if (outcome.duplicated) {
        setToast("이미 신고한 투표예요");
      } else if (outcome.blinded) {
        setToast("신고가 접수돼 비공개로 전환됐어요");
      } else {
        setToast("신고가 접수됐어요");
      }
    } catch (e) {
      console.error("[VoteDetail] report failed:", e);
      setToast("신고에 실패했어요. 잠시 후 다시 시도해주세요");
    } finally {
      setReportPending(false);
      setReportOpen(false);
    }
  };

  const handleShare = async (channel: ShareChannel) => {
    if (pendingChannel !== null) return;
    setPendingChannel(channel);
    try {
      if (channel === "url") {
        try {
          const link = await buildShareableLink(detail.id);
          await navigator.clipboard.writeText(link);
          setToast("링크가 복사됐어요");
        } catch {
          setToast("복사에 실패했어요");
        }
        return;
      }
      // 카카오톡/인스타그램 분기는 추후 지원 — 현재는 채널 union 에 url 만 존재
      // const label = channel === "kakao" ? "카카오톡" : "인스타그램";
      // setToast(`${label} 공유는 곧 지원될 예정이에요`);
    } finally {
      setTimeout(() => {
        setPendingChannel((prev) => (prev === channel ? null : prev));
      }, motion.toastMs);
    }
  };

  return (
    <AppShell hideBottomNav>
      <DetailHeader onBack={handleBack} onReport={() => setReportOpen(true)} />

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
          onWatch={requestUnlock}
          onHome={() => navigate("/", { replace: true })}
          accentBar={accent.bar}
          freePassBalance={freePassBalance}
        />
      ) : null}

      {phase === "result" ? (
        <>
          {detail.isClosed ? (
            <div
              style={{
                margin: `0 ${spacing.lg}px ${spacing.md}px`,
                padding: `${spacing.xs}px ${spacing.md}px`,
                borderRadius: radius.sm,
                background: palette.divider,
                color: palette.textSecondary,
                fontSize: fontSize.label,
                fontWeight: fontWeight.medium,
                alignSelf: "flex-start",
                width: "fit-content",
              }}
            >
              최종 결과
            </div>
          ) : null}
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

      <UnlockConfirmDialog
        open={confirmOpen}
        freePassBalance={freePassBalance}
        onUseFreePass={() => void unlockWithFreePass()}
        onWatchAd={() => void unlockWithAd()}
        onClose={() => setConfirmOpen(false)}
      />

      <ReportDialog
        open={reportOpen}
        pending={reportPending}
        onSelect={(reason) => void handleReportSelect(reason)}
        onClose={() => setReportOpen(false)}
      />
    </AppShell>
  );
}

function AdGate({
  watching,
  onWatch,
  onHome,
  accentBar,
  freePassBalance,
}: {
  watching: boolean;
  onWatch: () => void;
  onHome: () => void;
  accentBar: string;
  freePassBalance: number;
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
        {freePassBalance > 0
          ? `결과를 보려면 무료이용권을 쓰거나 광고를 시청해주세요. (보유 ${freePassBalance}개)`
          : "결과를 보려면 광고를 시청해주세요."}
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
          {watching
            ? "결과를 여는 중…"
            : freePassBalance > 0
              ? "결과 열기"
              : "광고 보고 결과 확인하기"}
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
