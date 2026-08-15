export const colors = {
  surface: "#0A0E27",
  onSurface: "#F4F6FF",
  surfaceSecondary: "#151B3D",
  onSurfaceSecondary: "#AEB6DE",
  surfaceTertiary: "#20285A",
  onSurfaceTertiary: "#7C86B8",
  brand: "#7C5CFF",
  brandSecondary: "#A88BFF",
  onBrand: "#FFFFFF",
  border: "#26305F",
  borderStrong: "#3A4585",
  divider: "#1A2148",
  success: "#22C55E",
  warning: "#F5A623",
  error: "#FF5A6A",
  info: "#20285A",
  sportTennis: "#DFFF00",
  sportPadel: "#FF6B6B",
  sportSquash: "#00FA9A",
  sportBadminton: "#FFC107",
  sportPickleball: "#39FF14",
} as const;

// A subtle 2-stop brand gradient for hero surfaces / CTAs.
export const brandGradient = ["#7C5CFF", "#4C2FD6"] as const;
export const surfaceGradient = ["#131A3E", "#0A0E27"] as const;

export const sportAccent = (id: string): string => {
  switch (id) {
    case "tennis": return colors.sportTennis;
    case "padel": return colors.sportPadel;
    case "squash": return colors.sportSquash;
    case "badminton": return colors.sportBadminton;
    case "pickleball": return colors.sportPickleball;
    default: return colors.brand;
  }
};

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 } as const;
export const radius = { sm: 4, md: 8, lg: 12, pill: 999 } as const;

export const fontDisplay = "BarlowCondensed";
export const fontText = "DMSans";
export const fontMono = "monospace";

export const font = {
  display: { fontFamily: fontDisplay, fontWeight: "700" as const },
  displayLight: { fontFamily: fontDisplay, fontWeight: "400" as const },
  text: { fontFamily: fontText, fontWeight: "400" as const },
  textMedium: { fontFamily: fontText, fontWeight: "600" as const },
  textBold: { fontFamily: fontText, fontWeight: "700" as const },
};

export const SPORT_ICONS: Record<string, string> = {
  squash: "ellipse-outline",
  padel: "grid-outline",
  tennis: "tennisball-outline",
  badminton: "sparkles-outline",
  pickleball: "disc-outline",
};

export const formatRating = (rating: number, decimals: number): string => {
  return decimals > 0 ? rating.toFixed(decimals) : Math.round(rating).toLocaleString();
};

export const timeAgo = (iso?: string | null): string => {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w ago`;
  return new Date(iso).toLocaleDateString();
};

export const REACTIONS: { type: string; icon: string; label: string }[] = [
  { type: "like", icon: "thumbs-up", label: "Like" },
  { type: "fire", icon: "flame", label: "Fire" },
  { type: "clap", icon: "hand-left", label: "Clap" },
  { type: "muscle", icon: "barbell", label: "Strong" },
  { type: "trophy", icon: "trophy", label: "GG" },
];
export const REACTION_ICON: Record<string, string> = {
  like: "thumbs-up", fire: "flame", clap: "hand-left", muscle: "barbell", trophy: "trophy",
};
export const CITY_COUNTRY: Record<string, string> = {
  london: "United Kingdom", manchester: "United Kingdom", birmingham: "United Kingdom",
  mumbai: "India", delhi: "India", bangalore: "India", bengaluru: "India",
  singapore: "Singapore", barcelona: "Spain", madrid: "Spain",
  dubai: "United Arab Emirates", "abu dhabi": "United Arab Emirates",
  "new york": "United States", "los angeles": "United States", "san francisco": "United States",
  sydney: "Australia", melbourne: "Australia", tokyo: "Japan", osaka: "Japan",
  toronto: "Canada", vancouver: "Canada", paris: "France", berlin: "Germany",
};
export const countryOf = (city?: string | null): string | null =>
  city ? CITY_COUNTRY[city.trim().toLowerCase()] || null : null;

export const CURRENCIES = ["INR", "GBP", "USD", "EUR", "AED", "AUD", "CAD", "SGD", "Other"];
