import type { Language } from "./schemas";

/** Display names, also used to instruct the model which language to write in. */
export const LANGUAGE_NAMES: Record<Language, string> = {
  en: "English",
  hi: "Hindi",
  ta: "Tamil",
  es: "Spanish",
  fr: "French",
  ar: "Arabic",
};

export function textDirection(language: Language): "ltr" | "rtl" {
  return language === "ar" ? "rtl" : "ltr";
}
