import { Top } from "@toss/tds-mobile";
import { AppShell } from "../../components/AppShell";
import { MyVotesSection } from "./components/MyVotesSection";
import { ParticipatedSection } from "./components/ParticipatedSection";
import { ProfileHeader } from "./components/ProfileHeader";
import { StatGrid } from "./components/StatGrid";
import { myStats, myVotes, participatedVotes, profile } from "./mocks";

export function MyPage() {
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

      <ProfileHeader profile={profile} />
      <StatGrid stats={myStats} />
      <MyVotesSection votes={myVotes} />
      <ParticipatedSection votes={participatedVotes} />
    </AppShell>
  );
}
