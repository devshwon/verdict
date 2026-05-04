import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { watchRewardAd } from "../../lib/ads";
import {
  getDailyMissions,
  getRegisterStatus,
  moderateVote,
  registerAdWatch,
  registerVote,
  type DailyMissions,
  type RegisterOutcome,
  type RegisterStatus,
} from "../../lib/db/votes";
import {
  MAX_CHOICES,
  MIN_CHOICES,
  QUESTION_MAX_LENGTH,
  type Choice,
  type DurationKey,
  type FieldKey,
  type RegisterCategory,
  type RegisterErrors,
  type RegisterPayload,
  type TouchedMap,
} from "./types";

const DURATION_MINUTES: Record<DurationKey, 5 | 10 | 30 | 60> = {
  m5: 5,
  m10: 10,
  m30: 30,
  h1: 60,
};

function buildPayload(
  question: string,
  filledChoices: string[],
  category: RegisterCategory | null,
  duration: DurationKey,
  todayCandidate: boolean,
): RegisterPayload | null {
  if (
    question.trim().length === 0 ||
    question.length > QUESTION_MAX_LENGTH ||
    filledChoices.length < MIN_CHOICES ||
    category === null
  ) {
    return null;
  }
  return {
    question: question.trim(),
    choices: filledChoices,
    category,
    duration,
    todayCandidate,
  };
}

export type RegisterSuccessKind = "approved" | "rejected" | "moderation_failed";

type Options = {
  onSuccess?: (
    voteId: string,
    payload: RegisterPayload,
    kind: RegisterSuccessKind,
    rejectionReason?: string | null,
    adUsedAtRegister?: boolean,
  ) => void;
  onError?: (outcome: Extract<RegisterOutcome, { ok: false }>) => void;
};

export function useRegisterForm(options: Options = {}) {
  const { onSuccess, onError } = options;
  const idCounterRef = useRef(2);
  const [question, setQuestion] = useState("");
  const [choices, setChoices] = useState<Choice[]>([
    { id: "c0", value: "" },
    { id: "c1", value: "" },
  ]);
  const [category, setCategory] = useState<RegisterCategory | null>(null);
  const [duration, setDuration] = useState<DurationKey>("h1");
  const [todayCandidate, setTodayCandidate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [touched, setTouched] = useState<TouchedMap>({});
  const [status, setStatus] = useState<RegisterStatus | null>(null);
  const [missions, setMissions] = useState<DailyMissions | null>(null);
  // 사용자가 명시적으로 "광고로 등록" 선택 시 true (무료이용권 보유 중에도 광고 사용)
  const [forceAdMode, setForceAdMode] = useState(false);

  const submittingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const [s, m] = await Promise.all([
        getRegisterStatus(),
        getDailyMissions().catch((e) => {
          console.error("[useRegisterForm] missions load failed:", e);
          return null;
        }),
      ]);
      if (mountedRef.current) {
        setStatus(s);
        setMissions(m);
      }
    } catch (e) {
      console.error("[useRegisterForm] status load failed:", e);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const filledChoices = useMemo(
    () => choices.map((c) => c.value.trim()).filter((v) => v.length > 0),
    [choices],
  );

  const errors: RegisterErrors = useMemo(() => {
    const e: RegisterErrors = {};
    if (question.trim().length === 0) {
      e.question = "질문을 입력해주세요.";
    }
    if (filledChoices.length < MIN_CHOICES) {
      e.choices = `선택지를 ${MIN_CHOICES}개 이상 입력해주세요.`;
    }
    if (category === null) {
      e.category = "카테고리를 선택해주세요.";
    }
    return e;
  }, [question, filledChoices.length, category]);

  const visibleErrors: RegisterErrors = useMemo(() => {
    const v: RegisterErrors = {};
    (Object.keys(errors) as FieldKey[]).forEach((k) => {
      if (touched[k]) v[k] = errors[k];
    });
    return v;
  }, [errors, touched]);

  // 캡 도달 / 정지 시 제출 차단
  const capBlocked = useMemo(() => {
    if (!status) return false;
    if (status.registerBlocked) return true;
    if (todayCandidate) return status.todayCandidateCapReached;
    return status.normalCapReached;
  }, [status, todayCandidate]);

  // 광고 또는 무료이용권이 필요한 시점 (3건째+ normal)
  const requiresGate = useMemo(() => {
    if (!status || todayCandidate) return false;
    return status.nextNormalRequiresAd;
  }, [status, todayCandidate]);

  const hasFreePass = (missions?.freePassBalance ?? 0) > 0;

  // 게이트가 필요한 상황에서 무료이용권을 자동 사용할지 여부
  const willUseFreePass = requiresGate && hasFreePass && !forceAdMode;
  // 광고 시청이 필요한 시점 (게이트 + 무료이용권 미사용)
  const requiresAd = requiresGate && !willUseFreePass;

  const canSubmit =
    Object.keys(errors).length === 0 && !submitting && !capBlocked;

  const updateQuestion = (next: string) => {
    if (next.length > QUESTION_MAX_LENGTH) return;
    setQuestion(next);
  };

  const updateChoice = (id: string, next: string) => {
    setChoices((prev) =>
      prev.map((c) => (c.id === id ? { ...c, value: next } : c)),
    );
  };

  const addChoice = () => {
    setChoices((prev) => {
      if (prev.length >= MAX_CHOICES) return prev;
      const id = `c${idCounterRef.current}`;
      idCounterRef.current += 1;
      return [...prev, { id, value: "" }];
    });
  };

  const removeChoice = (id: string) => {
    setChoices((prev) => {
      if (prev.length <= MIN_CHOICES) return prev;
      return prev.filter((c) => c.id !== id);
    });
  };

  const markTouched = (field: FieldKey) => {
    setTouched((prev) => (prev[field] ? prev : { ...prev, [field]: true }));
  };

  const resetForm = () => {
    setQuestion("");
    setChoices([
      { id: "c0", value: "" },
      { id: "c1", value: "" },
    ]);
    idCounterRef.current = 2;
    setCategory(null);
    setDuration("h1");
    setTodayCandidate(false);
    setTouched({});
  };

  const submit = async () => {
    if (submittingRef.current) return;
    setTouched({ question: true, choices: true, category: true });

    const payload = buildPayload(
      question,
      filledChoices,
      category,
      duration,
      todayCandidate,
    );
    if (payload === null || capBlocked) return;

    submittingRef.current = true;
    setSubmitting(true);

    try {
      // 3건째+ 일반 등록은 무료이용권 우선 사용, 없거나 강제 광고 모드면 광고 시청
      let adUsed = false;
      let useFreePass = false;
      let adToken: string | undefined;
      if (willUseFreePass) {
        useFreePass = true;
      } else if (requiresAd) {
        await watchRewardAd();
        const tokenOutcome = await registerAdWatch("register_3plus");
        if (!tokenOutcome.ok) {
          if (mountedRef.current) {
            onError?.({
              ok: false,
              reason: "unknown",
              message: tokenOutcome.message,
            });
          }
          return;
        }
        adToken = tokenOutcome.adToken;
        adUsed = true;
      }

      const outcome = await registerVote({
        question: payload.question,
        options: payload.choices,
        category: payload.category,
        durationMinutes: DURATION_MINUTES[payload.duration],
        todayCandidate: payload.todayCandidate,
        adUsed,
        useFreePass,
        adToken,
      });

      if (!mountedRef.current) return;

      if (outcome.ok) {
        // 등록 성공 → 검열 진행. 검열 결과로 토스트 분기
        const moderation = await moderateVote(outcome.voteId);
        let kind: RegisterSuccessKind = "moderation_failed";
        let rejectionReason: string | null = null;
        if (moderation.ok) {
          kind = moderation.approved ? "approved" : "rejected";
          rejectionReason = moderation.rejectionReason;
        }
        onSuccess?.(outcome.voteId, payload, kind, rejectionReason, adUsed);
        resetForm();
        setForceAdMode(false);
        await refreshStatus();
      } else {
        onError?.(outcome);
        // 캡/정지/ad 상태가 바뀌었을 수 있으니 새로고침
        await refreshStatus();
      }
    } catch (e) {
      if (!mountedRef.current) return;
      console.error("[useRegisterForm] submit error:", e);
      // 디버깅 편의를 위해 실제 원인을 토스트로 노출 (광고 SDK reject / 네트워크 / 토큰 등)
      // TODO: 운영 안정화 후 사용자 친화 메시지로 교체
      const detail =
        e instanceof Error
          ? `${e.name}: ${e.message}`
          : typeof e === "string"
            ? e
            : (() => {
                try {
                  return JSON.stringify(e);
                } catch {
                  return String(e);
                }
              })();
      onError?.({
        ok: false,
        reason: "unknown",
        message: `등록 실패 — ${detail}`,
      });
    } finally {
      if (mountedRef.current) setSubmitting(false);
      submittingRef.current = false;
    }
  };

  return {
    question,
    choices,
    category,
    duration,
    todayCandidate,
    submitting,
    canSubmit,
    capBlocked,
    requiresGate,
    requiresAd,
    willUseFreePass,
    hasFreePass,
    forceAdMode,
    setForceAdMode,
    status,
    missions,
    errors: visibleErrors,
    updateQuestion,
    updateChoice,
    addChoice,
    removeChoice,
    setCategory,
    setDuration,
    setTodayCandidate,
    markTouched,
    submit,
  };
}
