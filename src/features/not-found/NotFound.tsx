import { Button, Top } from "@toss/tds-mobile";
import { useNavigate } from "react-router-dom";
import { AppShell } from "../../components/AppShell";
import {
  borderWidth,
  fontSize,
  palette,
  radius,
  spacing,
} from "../../design/tokens";

export function NotFound() {
  const navigate = useNavigate();
  return (
    <AppShell>
      <Top
        title={
          <Top.TitleParagraph size={fontSize.hero}>
            찾을 수 없어요
          </Top.TitleParagraph>
        }
        subtitleBottom={
          <Top.SubtitleParagraph size={fontSize.subtitle}>
            요청하신 페이지가 없거나 이동됐어요
          </Top.SubtitleParagraph>
        }
      />
      <div
        style={{
          margin: `${spacing.xl}px ${spacing.lg}px`,
          padding: spacing.xl,
          borderRadius: radius.lg,
          border: `${borderWidth.hairline}px solid ${palette.border}`,
          background: palette.background,
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: spacing.md,
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: fontSize.body,
            color: palette.textSecondary,
          }}
        >
          홈으로 돌아가서 다시 시도해주세요.
        </p>
        <Button
          variant="fill"
          size="medium"
          onClick={() => navigate("/", { replace: true })}
        >
          홈으로
        </Button>
      </div>
    </AppShell>
  );
}
