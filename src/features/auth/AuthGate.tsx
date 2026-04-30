import { Button } from "@toss/tds-mobile";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  fontSize,
  fontWeight,
  lineHeight,
  palette,
  spacing,
} from "../../design/tokens";
import { loginWithToss } from "../../config/auth";
import { supabase } from "../../config/supabase";

type Status = "loading" | "ready" | "error";

interface Props {
  children: ReactNode;
}

export function AuthGate({ children }: Props) {
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  // StrictMode dev 2회 마운트 / 동시 클릭으로 appLogin이 중복 호출되면
  // authorizationCode가 한쪽에서 소진되어 invalid_grant 발생. 진행 중 가드.
  const inFlightRef = useRef(false);

  useEffect(() => {
    bootstrap();
  }, []);

  async function bootstrap() {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setStatus("loading");
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        setStatus("ready");
        return;
      }
      await loginWithToss();
      setStatus("ready");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[AuthGate] bootstrap failed:", msg);
      setError(msg);
      setStatus("error");
    } finally {
      inFlightRef.current = false;
    }
  }

  if (status === "loading") {
    return (
      <div style={containerStyle}>
        <p style={textStyle}>토스 로그인 중…</p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div style={containerStyle}>
        <p style={textStyle}>로그인에 실패했어요</p>
        {error ? <p style={errorTextStyle}>{error}</p> : null}
        <div style={{ marginTop: spacing.md }}>
          <Button size="medium" variant="fill" color="primary" onClick={bootstrap}>
            다시 시도
          </Button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

const containerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  height: "100dvh",
  padding: spacing.xxl,
  gap: spacing.md,
  background: palette.surface,
};

const textStyle: React.CSSProperties = {
  fontSize: fontSize.button,
  fontWeight: fontWeight.medium,
  color: palette.textPrimary,
  margin: 0,
};

const errorTextStyle: React.CSSProperties = {
  fontSize: fontSize.label,
  color: palette.textSecondary,
  margin: 0,
  textAlign: "center",
  lineHeight: lineHeight.body,
};
