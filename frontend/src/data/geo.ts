// Bundled, offline country + city dataset for consistent structured selection.
// Not exhaustive — covers the countries/cities most relevant to racket sports.
// Keeps Events data consistent (no free-text typos) and needs no external API.

export type Country = { code: string; name: string; cities: string[] };

export const COUNTRIES: Country[] = [
  { code: "GB", name: "United Kingdom", cities: ["London", "Manchester", "Birmingham", "Leeds", "Liverpool", "Bristol", "Edinburgh", "Glasgow", "Sheffield", "Nottingham"] },
  { code: "IN", name: "India", cities: ["Mumbai", "Delhi", "Bengaluru", "Hyderabad", "Chennai", "Kolkata", "Pune", "Ahmedabad", "Jaipur", "Chandigarh"] },
  { code: "US", name: "United States", cities: ["New York", "Los Angeles", "Chicago", "Houston", "Miami", "San Francisco", "Boston", "Seattle", "Austin", "Denver"] },
  { code: "AE", name: "United Arab Emirates", cities: ["Dubai", "Abu Dhabi", "Sharjah", "Ajman"] },
  { code: "AU", name: "Australia", cities: ["Sydney", "Melbourne", "Brisbane", "Perth", "Adelaide", "Canberra"] },
  { code: "CA", name: "Canada", cities: ["Toronto", "Vancouver", "Montreal", "Calgary", "Ottawa", "Edmonton"] },
  { code: "ES", name: "Spain", cities: ["Madrid", "Barcelona", "Valencia", "Seville", "Malaga", "Bilbao"] },
  { code: "FR", name: "France", cities: ["Paris", "Lyon", "Marseille", "Toulouse", "Nice", "Bordeaux"] },
  { code: "DE", name: "Germany", cities: ["Berlin", "Munich", "Hamburg", "Frankfurt", "Cologne", "Stuttgart"] },
  { code: "IT", name: "Italy", cities: ["Rome", "Milan", "Naples", "Turin", "Florence", "Bologna"] },
  { code: "NL", name: "Netherlands", cities: ["Amsterdam", "Rotterdam", "The Hague", "Utrecht", "Eindhoven"] },
  { code: "SG", name: "Singapore", cities: ["Singapore"] },
  { code: "ZA", name: "South Africa", cities: ["Johannesburg", "Cape Town", "Durban", "Pretoria"] },
  { code: "NZ", name: "New Zealand", cities: ["Auckland", "Wellington", "Christchurch"] },
  { code: "IE", name: "Ireland", cities: ["Dublin", "Cork", "Galway", "Limerick"] },
  { code: "PT", name: "Portugal", cities: ["Lisbon", "Porto", "Faro"] },
  { code: "SE", name: "Sweden", cities: ["Stockholm", "Gothenburg", "Malmö"] },
  { code: "EG", name: "Egypt", cities: ["Cairo", "Alexandria", "Giza"] },
  { code: "MY", name: "Malaysia", cities: ["Kuala Lumpur", "Penang", "Johor Bahru"] },
  { code: "QA", name: "Qatar", cities: ["Doha"] },
];

export const COUNTRY_NAMES = COUNTRIES.map((c) => c.name);

export function citiesFor(countryName?: string | null): string[] {
  const c = COUNTRIES.find((x) => x.name === countryName);
  return c ? c.cities : [];
}
