import { Toast, Top } from "@toss/tds-mobile";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "../../components/AppShell";
import {
  fontSize,
  motion,
  palette,
  spacing,
} from "../../design/tokens";
import { fetchMyPageData, type MyPageData } from "../../lib/db/mypage";
import {
  getDailyMissions,
  getUnclaimedPoints,
  type DailyMissions,
  type UnclaimedPoint,
} from "../../lib/db/votes";
import { ClaimRewardsCard } from "./components/ClaimRewardsCard";
import { DailyMissionCard } from "./components/DailyMissionCard";
import { DemographicsCard } from "./components/DemographicsCard";
import { FreePassCard } from "./components/FreePassCard";
import { InquiryCard } from "./components/InquiryCard";
import { MyVotesSection } from "./components/MyVotesSection";
import { ParticipatedSection } from "./components/ParticipatedSection";
import { ProfileHeader } from "./components/ProfileHeader";
import { StatGrid } from "./components/StatGrid";

type Status = "loading" | "ready" | "error";

export function MyPage() {
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<MyPageData | null>(null);
  const [missions, setMissions] = useState<DailyMissions | null>(null);
  const [unclaimed, setUnclaimed] = useState<UnclaimedPoint[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const [pageData, missionsData, unclaimedData] = await Promise.all([
        fetchMyPageData(),
        getDailyMissions().catch((e) => {
          console.error("[MyPage] missions load failed:", e);
          return null;
        }),
        getUnclaimedPoints().catch((e) => {
          console.error("[MyPage] unclaimed load failed:", e);
          return [];
        }),
      ]);
      setData(pageData);
      setMissions(missionsData);
      setUnclaimed(unclaimedData);
      setStatus("ready");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[MyPage] load failed:", msg);
      setError(msg);
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AppShell>
      <Top
        title={<Top.TitleParagraph size={22}>마이</Top.TitleParagraph>}
        subtitleBottom={
          <Top.SubtitleParagraph size={15}>
            나의 활동과 결과를 한눈에
          </Top.SubtitleParagraph>
        }
      />

      {status === "loading" ? (
        <Message>불러오는 중…</Message>
      ) : status === "error" ? (
        <Message>불러오기에 실패했어요{error ? ` (${error})` : ""}</Message>
      ) : data === null ? (
        <Message>로그인 정보를 찾을 수 없어요.</Message>
      ) : (
        <>
          <ProfileHeader profile={data.profile} />
          <StatGrid stats={data.stats} />
          <ClaimRewardsCard
            rewards={unclaimed}
            onClaimed={(count, totalAmount) => {
              if (count > 0) {
                setToast(`${totalAmount}P 받기 신청 완료!`);
                void load();
              }
            }}
            onError={(msg) => setToast(msg)}
          />
          {missions ? <DailyMissionCard missions={missions} /> : null}
          {missions ? (
            <FreePassCard
              balance={missions.freePassBalance}
              adClaimedToday={missions.adClaimedToday}
              onClaimed={() => {
                setToast("무료이용권 1개를 받았어요");
                void load();
              }}
              onError={(msg) => setToast(msg)}
            />
          ) : null}
          <DemographicsCard
            demographics={data.demographics}
            onUpdated={() => {
              setToast("공개 설정을 변경했어요");
              void load();
            }}
            onError={(msg) => setToast(msg)}
          />
          <MyVotesSection votes={data.myVotes} />
          <ParticipatedSection votes={data.participatedVotes} />
          <InquiryCard
            onSubmitted={() => setToast("문의가 접수됐어요. 감사합니다!")}
            onError={(msg) => setToast(msg)}
          />
        </>
      )}

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

function Message({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        margin: `${spacing.xl}px ${spacing.lg}px`,
        padding: spacing.xl,
        textAlign: "center",
        color: palette.textSecondary,
        fontSize: fontSize.body,
      }}
    >
      {children}
    </div>
  );
}
