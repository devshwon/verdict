import { Top } from "@toss/tds-mobile";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "../../components/AppShell";
import {
  fontSize,
  fontWeight,
  palette,
  spacing,
} from "../../design/tokens";
import { fetchPastTodayVotes } from "../../lib/db/votes";
import type { PastTodayVote } from "../home/types";
import { PastVoteCard } from "./components/PastVoteCard";

const ARCHIVE_LIMIT = 200;

const monthFormatter = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "long",
});

type Status = "loading" | "ready" | "error";

export function TodayArchive() {
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [votes, setVotes] = useState<PastTodayVote[]>([]);

  const load = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const rows = await fetchPastTodayVotes("all", ARCHIVE_LIMIT);
      setVotes(rows);
      setStatus("ready");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[TodayArchive] load failed:", msg);
      setError(msg);
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = useMemo(() => groupByMonth(votes), [votes]);

  return (
    <AppShell>
      <ArchiveTop />
      {status === "loading" ? (
        <Message>불러오는 중…</Message>
      ) : status === "error" ? (
        <Message>불러오기에 실패했어요{error ? ` (${error})` : ""}</Message>
      ) : grouped.length === 0 ? (
        <Empty />
      ) : (
        grouped.map(([month, items]) => (
          <section
            key={month}
            style={{
              margin: `${spacing.md}px ${spacing.lg}px`,
              display: "flex",
              flexDirection: "column",
              gap: spacing.sm,
            }}
          >
            <h2
              style={{
                margin: 0,
                fontSize: fontSize.subtitle,
                fontWeight: fontWeight.bold,
                color: palette.textPrimary,
              }}
            >
              {formatMonthLabel(month)}
            </h2>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: spacing.sm,
              }}
            >
              {items.map((vote) => (
                <PastVoteCard key={vote.id} vote={vote} variant="row" />
              ))}
            </div>
          </section>
        ))
      )}
    </AppShell>
  );
}

function ArchiveTop() {
  return (
    <Top
      title={
        <Top.TitleParagraph size={fontSize.hero}>
          지난 오늘의 투표
        </Top.TitleParagraph>
      }
      subtitleBottom={
        <Top.SubtitleParagraph size={fontSize.subtitle}>
          놓친 오늘의 투표 결과를 광고 시청 후 확인해요
        </Top.SubtitleParagraph>
      }
    />
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

function Empty() {
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
      아직 지난 투표가 없어요.
    </div>
  );
}

function groupByMonth(items: PastTodayVote[]) {
  const map = new Map<string, PastTodayVote[]>();
  for (const v of items) {
    const month = v.endedAt.slice(0, 7);
    const list = map.get(month) ?? [];
    list.push(v);
    map.set(month, list);
  }
  return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
}

function formatMonthLabel(ym: string) {
  const [y, m] = ym.split("-");
  return monthFormatter.format(new Date(Number(y), Number(m) - 1, 1));
}
