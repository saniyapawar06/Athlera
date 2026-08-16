export const colors = {
  surface: "#0B0D12",
  onSurface: "#F3F4F6",
  surfaceSecondary: "#151821",
  onSurfaceSecondary: "#9CA3AF",
  surfaceTertiary: "#1F232F",
  onSurfaceTertiary: "#6B7280",
  brand: "#E62E2D",
  brandSecondary: "#FF5C5C",
  onBrand: "#FFFFFF",
  border: "#242938",
  borderStrong: "#374151",
  divider: "#1F232F",
  success: "#10B981",
  warning: "#F59E0B",
  error: "#EF4444",
  info: "#374151",
  sportTennis: "#DFFF00",
  sportPadel: "#FF6B6B",
  sportSquash: "#00FA9A",
  sportBadminton: "#FFC107",
  sportPickleball: "#39FF14",
} as const;

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
  squash: "🎾",
  padel: "🎾",
  tennis: "🎾",
  badminton: "🏸",
  pickleball: "🥒",
};

export const formatRating = (rating: number, decimals: number): string => {
  return decimals > 0 ? rating.toFixed(decimals) : Math.round(rating).toLocaleString();
};
