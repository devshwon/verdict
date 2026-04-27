export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  pill: 999,
} as const;

export const fontSize = {
  caption: 11,
  body: 14,
  subtitle: 15,
  title: 17,
  heading: 20,
} as const;

export const palette = {
  background: "#FFFFFF",
  surface: "#FAF9F6",
  border: "#ECEAE3",
  divider: "#F1EFE8",
  textPrimary: "#1F1E1A",
  textSecondary: "#888780",
  textTertiary: "#B4B2A9",
  brand: "#534AB7",
  brandSurface: "#EEEDFE",
  brandText: "#3C3489",
} as const;

export type CategoryKey = "all" | "daily" | "game" | "love" | "work" | "etc";

export const categories: { key: CategoryKey; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "daily", label: "일상" },
  { key: "game", label: "게임" },
  { key: "love", label: "연애·관계" },
  { key: "work", label: "직장·학교" },
  { key: "etc", label: "기타" },
];

export const TODAY_CARD_CATEGORIES: CategoryKey[] = [
  "daily",
  "game",
  "love",
  "work",
];

export const categoryColors: Record<
  Exclude<CategoryKey, "all">,
  { surface: string; text: string; bar: string }
> = {
  daily: { surface: "#EEEDFE", text: "#3C3489", bar: "#534AB7" },
  game: { surface: "#E1F5EE", text: "#085041", bar: "#1D9E75" },
  love: { surface: "#FBEAF0", text: "#72243E", bar: "#D4537E" },
  work: { surface: "#FAEEDA", text: "#633806", bar: "#BA7517" },
  etc: { surface: "#F1EFE8", text: "#5F5E5A", bar: "#888780" },
};

export type FeedTagKey = "popular" | "new" | "closed";

export const feedTagStyles: Record<
  FeedTagKey,
  { surface: string; text: string; label: string }
> = {
  popular: { surface: "#FAECE7", text: "#712B13", label: "인기" },
  new: { surface: "#EAF3DE", text: "#27500A", label: "신규" },
  closed: { surface: "#F1EFE8", text: "#5F5E5A", label: "마감" },
};

export const todayTagStyle = {
  surface: "#EEEDFE",
  text: "#3C3489",
  label: "오늘의 투표",
};
