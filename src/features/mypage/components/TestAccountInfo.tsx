// TODO: 테스트용 패널 — 토스 로그인 직후 받아온 계정/인구통계 raw 값을 노출.
// 디버깅 끝나면 파일째 삭제하고 MyPage.tsx에서 import 한 줄만 지우면 됨.
import { useEffect, useState } from "react";
import { supabase } from "../../../config/supabase";
import {
  borderWidth,
  fontSize,
  fontWeight,
  palette,
  radius,
  spacing,
} from "../../../design/tokens";

type UserRowAll = {
  id: string;
  gender: string;
  gender_raw: string | null;
  gender_public: boolean;
  age_bucket: string;
  age_bucket_raw: string | null;
  age_public: boolean;
  created_at?: string;
};

type AuthUserSnapshot = {
  id: string;
  email: string | null;
  createdAt: string | null;
  lastSignInAt: string | null;
  appMetadata: Record<string, unknown>;
  userMetadata: Record<string, unknown>;
};

export function TestAccountInfo() {
  const [authUser, setAuthUser] = useState<AuthUserSnapshot | null>(null);
  const [userRow, setUserRow] = useState<UserRowAll | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error: authErr } = await supabase.auth.getUser();
        if (authErr) throw authErr;
        const u = data.user;
        if (!u) {
          if (!cancelled) setError("auth user 없음");
          return;
        }
        const snapshot: AuthUserSnapshot = {
          id: u.id,
          email: u.email ?? null,
          createdAt: u.created_at ?? null,
          lastSignInAt: u.last_sign_in_at ?? null,
          appMetadata: u.app_metadata ?? {},
          userMetadata: u.user_metadata ?? {},
        };
        if (!cancelled) setAuthUser(snapshot);

        const { data: row, error: rowErr } = await supabase
          .from("users")
          .select(
            "id, gender, gender_raw, gender_public, age_bucket, age_bucket_raw, age_public, created_at",
          )
          .eq("id", u.id)
          .single();
        if (rowErr) throw rowErr;
        if (!cancelled) setUserRow(row as UserRowAll);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!cancelled) setError(msg);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section
      style={{
        margin: `${spacing.md}px ${spacing.lg}px`,
        padding: spacing.md,
        borderRadius: radius.lg,
        border: `${borderWidth.hairline}px dashed ${palette.border}`,
        background: palette.surface,
        display: "flex",
        flexDirection: "column",
        gap: spacing.sm,
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: fontSize.label,
            fontWeight: fontWeight.bold,
            color: palette.textPrimary,
          }}
        >
          [테스트] 토스 로그인 계정 정보
        </h3>
        <span style={{ fontSize: fontSize.small, color: palette.textTertiary }}>
          디버깅용 · 추후 제거
        </span>
      </header>

      {error ? <Field label="error" value={error} /> : null}

      {authUser ? (
        <>
          <Field label="auth.id" value={authUser.id} />
          <Field label="auth.email" value={authUser.email ?? "(없음)"} />
          <Field
            label="auth.created_at"
            value={authUser.createdAt ?? "(없음)"}
          />
          <Field
            label="auth.last_sign_in_at"
            value={authUser.lastSignInAt ?? "(없음)"}
          />
          <Field
            label="auth.app_metadata"
            value={JSON.stringify(authUser.appMetadata)}
          />
          <Field
            label="auth.user_metadata"
            value={JSON.stringify(authUser.userMetadata)}
          />
        </>
      ) : null}

      {userRow ? (
        <>
          <Divider />
          <Field
            label="users.gender (effective)"
            value={String(userRow.gender)}
          />
          <Field
            label="users.gender_raw (토스 원본)"
            value={String(userRow.gender_raw ?? "(null)")}
          />
          <Field
            label="users.gender_public"
            value={String(userRow.gender_public)}
          />
          <Field
            label="users.age_bucket (effective)"
            value={String(userRow.age_bucket)}
          />
          <Field
            label="users.age_bucket_raw (토스 원본)"
            value={String(userRow.age_bucket_raw ?? "(null)")}
          />
          <Field
            label="users.age_public"
            value={String(userRow.age_public)}
          />
        </>
      ) : null}
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        gap: spacing.sm,
        fontSize: fontSize.small,
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        color: palette.textPrimary,
        wordBreak: "break-all",
      }}
    >
      <span style={{ color: palette.textTertiary, flexShrink: 0 }}>
        {label}
      </span>
      <span>{value}</span>
    </div>
  );
}

function Divider() {
  return (
    <div
      style={{
        height: borderWidth.hairline,
        background: palette.border,
        margin: `${spacing.xs}px 0`,
      }}
    />
  );
}
