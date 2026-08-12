// Loads ATHLERA typography (Barlow Condensed + DM Sans) from bundled TTFs.
// Local assets → reliable on Expo Go (native) and web, no CDN dependency.
import { useFonts } from "expo-font";

export const useAppFonts = (): readonly [boolean, Error | null] =>
  useFonts({
    BarlowCondensed: require("../../assets/fonts/BarlowCondensed-Bold.ttf"),
    BarlowCondensedRegular: require("../../assets/fonts/BarlowCondensed-Regular.ttf"),
    BarlowCondensedSemiBold: require("../../assets/fonts/BarlowCondensed-SemiBold.ttf"),
    DMSans: require("../../assets/fonts/DMSans-Regular.ttf"),
    DMSansMedium: require("../../assets/fonts/DMSans-Medium.ttf"),
    DMSansBold: require("../../assets/fonts/DMSans-Bold.ttf"),
  });
