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
