import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { loginWithToss } from "../../config/auth";
import { supabase } from "../../config/supabase";

type Status = "loading" | "ready" | "error";

interface Props {
  children: ReactNode;
}

/**
 * 앱 진입 시 토스 자동 로그인 → Supabase 세션 확립.
 * 세션이 이미 있으면 그대로 통과. 없으면 appLogin() 호출.
 * 인증 완료 전까지 children 렌더링 차단.
 */
export function AuthGate({ children }: Props) {
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    bootstrap();
  }, []);

  async function bootstrap() {
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
    }
  }

  if (status === "loading") {
    return (
      <div style={containerStyle}>
        <p style={textStyle}>토스 로그인 중...</p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div style={containerStyle}>
        <p style={textStyle}>로그인 실패</p>
        <p style={errorTextStyle}>{error}</p>
        <button style={buttonStyle} onClick={bootstrap}>
          다시 시도
        </button>
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
  padding: "24px",
  gap: "12px",
};

const textStyle: React.CSSProperties = {
  fontSize: "16px",
  color: "#191F28",
  margin: 0,
};

const errorTextStyle: React.CSSProperties = {
  fontSize: "13px",
  color: "#8B95A1",
  margin: 0,
  textAlign: "center",
  maxWidth: "320px",
};

const buttonStyle: React.CSSProperties = {
  marginTop: "16px",
  padding: "10px 20px",
  border: "none",
  borderRadius: "8px",
  background: "#3182F6",
  color: "white",
  fontSize: "14px",
  fontWeight: 600,
  cursor: "pointer",
};
