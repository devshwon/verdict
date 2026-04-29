import { Top } from "@toss/tds-mobile";
import { palette, spacing } from "../../design/tokens";
import { MyVotesSection } from "./components/MyVotesSection";
import { ParticipatedSection } from "./components/ParticipatedSection";
import { ProfileHeader } from "./components/ProfileHeader";
import { StatGrid } from "./components/StatGrid";
import { myStats, myVotes, participatedVotes, profile } from "./mocks";

export function MyPage() {
  return (
    <div
      style={{
        background: palette.surface,
        minHeight: "100vh",
        paddingBottom: spacing.xxl,
      }}
    >
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
    </div>
  );
}
