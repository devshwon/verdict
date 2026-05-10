import { useState } from "react";
import { SectionTitle } from "../../../components/SectionTitle";
import { signOut } from "../../../config/auth";
import {
  borderWidth,
  fontSize,
  fontWeight,
  lineHeight,
  palette,
  radius,
  spacing,
} from "../../../design/tokens";
import {
  updateDemographicsVisibility,
  type MyPageDemographics,
} from "../../../lib/db/mypage";

type Props = {
  demographics: MyPageDemographics;
  onUpdated: () => void;
  onError: (message: string) => void;
};

const GENDER_LABEL: Record<MyPageDemographics["gender"], string> = {
  M: "남성",
  F: "여성",
  undisclosed: "비공개",
};

const AGE_LABEL: Record<MyPageDemographics["ageBucket"], string> = {
  age_20s: "20대",
  age_30s: "30대",
  age_40plus: "40대+",
  undisclosed: "비공개",
};

export function DemographicsCard({ demographics, onUpdated, onError }: Props) {
  const [genderUpdating, setGenderUpdating] = useState(false);
  const [ageUpdating, setAgeUpdating] = useState(false);
  const [resetting, setResetting] = useState(false);

  // effective='undisclosed' 면 raw 가 비어있거나 비공개 — 토스 OAuth 재진입으로 동의 받을 수 있음.
  const needsReconsent =
    demographics.gender === "undisclosed" ||
    demographics.ageBucket === "undisclosed";

  const handleReconsent = async () => {
    if (resetting) return;
    const confirmed = window.confirm(
      "토스 로그인을 다시 진행해서 성별/연령대 정보 동의를 받습니다.\n\n현재 데이터는 유지되고 토스 동의 화면이 표시돼요. 진행할까요?",
    );
    if (!confirmed) return;
    setResetting(true);
    try {
      await signOut();
      window.location.reload();
    } catch (e) {
      setResetting(false);
      onError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleToggleGender = async () => {
    if (genderUpdating) return;
    setGenderUpdating(true);
    try {
      await updateDemographicsVisibility({
        genderPublic: !demographics.genderPublic,
      });
      onUpdated();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      onError(msg);
    } finally {
      setGenderUpdating(false);
    }
  };

  const handleToggleAge = async () => {
    if (ageUpdating) return;
    setAgeUpdating(true);
    try {
      await updateDemographicsVisibility({
        agePublic: !demographics.agePublic,
      });
      onUpdated();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      onError(msg);
    } finally {
      setAgeUpdating(false);
    }
  };

  return (
    <section
      style={{
        margin: `0 ${spacing.lg}px ${spacing.xl}px`,
        display: "flex",
        flexDirection: "column",
        gap: spacing.md,
      }}
    >
      <SectionTitle>인구통계 공개 설정</SectionTitle>
      <div
        style={{
          padding: spacing.md,
          borderRadius: radius.lg,
          background: palette.background,
          border: `${borderWidth.hairline}px solid ${palette.border}`,
          display: "flex",
          flexDirection: "column",
          gap: spacing.sm,
        }}
      >
        <Row
          label="성별"
          valueLabel={
            demographics.genderPublic
              ? GENDER_LABEL[demographics.gender]
              : "비공개"
          }
          isPublic={demographics.genderPublic}
          loading={genderUpdating}
          onToggle={handleToggleGender}
        />
        <Row
          label="연령대"
          valueLabel={
            demographics.agePublic
              ? AGE_LABEL[demographics.ageBucket]
              : "비공개"
          }
          isPublic={demographics.agePublic}
          loading={ageUpdating}
          onToggle={handleToggleAge}
        />
        <p
          style={{
            margin: 0,
            marginTop: spacing.xs,
            fontSize: fontSize.small,
            color: palette.textTertiary,
            lineHeight: lineHeight.body,
          }}
        >
          값은 토스 인증 정보를 따라요. 비공개로 두면 투표 결과 집계에서 본인의 응답이 별도 카운트로 분류돼요.
        </p>

        {needsReconsent ? (
          <button
            type="button"
            onClick={() => void handleReconsent()}
            disabled={resetting}
            style={{
              marginTop: spacing.sm,
              padding: `${spacing.sm}px ${spacing.md}px`,
              borderRadius: radius.md,
              border: `${borderWidth.hairline}px solid ${palette.brand}`,
              background: resetting ? palette.divider : palette.brandSurface,
              color: resetting ? palette.textTertiary : palette.brandText,
              fontSize: fontSize.label,
              fontWeight: fontWeight.medium,
              cursor: resetting ? "default" : "pointer",
              alignSelf: "flex-start",
            }}
          >
            {resetting
              ? "토스 로그인 화면으로 이동 중…"
              : "토스 인증 정보 다시 받기"}
          </button>
        ) : null}
      </div>
    </section>
  );
}

function Row({
  label,
  valueLabel,
  isPublic,
  loading,
  onToggle,
}: {
  label: string;
  valueLabel: string;
  isPublic: boolean;
  loading: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: spacing.md,
        padding: `${spacing.xs}px 0`,
      }}
    >
      <span
        style={{
          fontSize: fontSize.label,
          fontWeight: fontWeight.medium,
          color: palette.textSecondary,
          width: 56,
        }}
      >
        {label}
      </span>
      <span
        style={{
          flex: 1,
          fontSize: fontSize.body,
          fontWeight: fontWeight.medium,
          color: palette.textPrimary,
        }}
      >
        {valueLabel}
      </span>
      <button
        type="button"
        onClick={onToggle}
        disabled={loading}
        aria-pressed={isPublic}
        style={{
          padding: `${spacing.xs}px ${spacing.md}px`,
          borderRadius: radius.pill,
          border: `${borderWidth.hairline}px solid ${
            isPublic ? palette.brand : palette.border
          }`,
          background: isPublic ? palette.brandSurface : palette.surface,
          color: isPublic ? palette.brandText : palette.textSecondary,
          fontSize: fontSize.small,
          fontWeight: fontWeight.medium,
          cursor: loading ? "default" : "pointer",
          opacity: loading ? 0.6 : 1,
        }}
      >
        {loading ? "변경 중…" : isPublic ? "공개" : "비공개"}
      </button>
    </div>
  );
}
