import { useEffect, useMemo, useRef, useState } from "react";
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

const SUBMIT_DELAY_MS = 500;

function buildPayload(
  question: string,
  filledChoices: string[],
  category: RegisterCategory | null,
  duration: DurationKey,
  todayCandidate: boolean
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

type Options = {
  onSuccess?: (payload: RegisterPayload) => void;
};

export function useRegisterForm(options: Options = {}) {
  const { onSuccess } = options;
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

  const submittingRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, []);

  const filledChoices = useMemo(
    () =>
      choices
        .map((c) => c.value.trim())
        .filter((v) => v.length > 0),
    [choices]
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

  const canSubmit =
    Object.keys(errors).length === 0 && !submitting;

  const updateQuestion = (next: string) => {
    if (next.length > QUESTION_MAX_LENGTH) return;
    setQuestion(next);
  };

  const updateChoice = (id: string, next: string) => {
    setChoices((prev) =>
      prev.map((c) => (c.id === id ? { ...c, value: next } : c))
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

  const submit = () => {
    if (submittingRef.current) return;
    setTouched({ question: true, choices: true, category: true });

    const payload = buildPayload(
      question,
      filledChoices,
      category,
      duration,
      todayCandidate
    );
    if (payload === null) return;

    submittingRef.current = true;
    setSubmitting(true);

    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      if (!mountedRef.current) return;
      setSubmitting(false);
      submittingRef.current = false;
      // TODO: 실제 등록 API 연동 시 교체
      onSuccess?.(payload);
      resetForm();
    }, SUBMIT_DELAY_MS);
  };

  return {
    question,
    choices,
    category,
    duration,
    todayCandidate,
    submitting,
    canSubmit,
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
