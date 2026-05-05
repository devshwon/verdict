import { supabase } from "../../config/supabase";

export const INQUIRY_MIN_LENGTH = 10;
export const INQUIRY_MAX_LENGTH = 1000;
export const INQUIRY_NICKNAME_MAX_LENGTH = 30;

export type CreateInquiryOutcome =
  | { ok: true; id: string }
  | { ok: false; reason: "auth" | "length" | "unknown"; message: string };

export async function createInquiry(
  message: string,
  nickname: string | null,
): Promise<CreateInquiryOutcome> {
  const trimmed = message.trim();
  if (trimmed.length < INQUIRY_MIN_LENGTH || trimmed.length > INQUIRY_MAX_LENGTH) {
    return {
      ok: false,
      reason: "length",
      message: `문의 내용은 ${INQUIRY_MIN_LENGTH}~${INQUIRY_MAX_LENGTH}자로 입력해주세요`,
    };
  }
  const trimmedNickname = nickname?.trim() ?? "";
  const { data, error } = await supabase.rpc("create_inquiry", {
    p_message: trimmed,
    p_nickname: trimmedNickname.length > 0 ? trimmedNickname : null,
  });
  if (error) {
    if (error.code === "28000") {
      return { ok: false, reason: "auth", message: "로그인이 필요해요" };
    }
    if (error.code === "23514") {
      return {
        ok: false,
        reason: "length",
        message: "입력 내용을 다시 확인해주세요",
      };
    }
    return {
      ok: false,
      reason: "unknown",
      message: error.message ?? "문의 접수에 실패했어요",
    };
  }
  return { ok: true, id: data as string };
}
