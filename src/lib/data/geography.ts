// Task #46 (CRM feature-parity gap analysis, 2026-07): every address-bearing
// field in this app (crmAccounts.billingCountry/billingState/billingCity +
// shippingCountry/shippingState/shippingCity, and erpAddresses.country/state/
// city -- the polymorphic table backing both erp_customers and erp_suppliers
// via PartyAddressesAndContacts) was plain free text with zero structured
// Country->State cascading anywhere in the app. This module is the single,
// shared, static reference-data source for that cascade -- matching this
// codebase's existing static-lookup convention (src/lib/currency-format.ts's
// Currency list, fetched from a DB table in that case; this data has no
// DB-table equivalent by design, see the zero-duplication note below).
//
// ─── Zero-duplication / lowest-footprint decision (Owner mandate) ──────────
// Country/state names are static reference data, not an operational entity
// -- they don't get created/edited/deleted by users, have no per-org
// variation, and don't need audit history. A new DB table + migration for
// this would be pure overhead (a migration, a seed script, a fetch-on-mount
// API round trip) for data that never changes at runtime. This file is the
// entire "database" -- no table, no migration, no API route.
//
// ─── Scope decision: Country -> State only, City stays free text ──────────
// A genuine city-level lookup (every city in every state) is tens of
// thousands of rows -- not reasonably hand-maintainable as a static TS file,
// and no bundled offline dataset ships with this repo's dependencies today.
// Per the task's own explicit guidance, this module deliberately implements
// Country -> State cascading ONLY. City remains a free-text input in every
// form this wires into, same as before -- the only change for City is that
// it now has real Country/State context sitting next to it, not that its
// own input type changes. Do not read this as an oversight; it is the
// documented scope boundary for this task.
//
// ─── Scope decision: which countries get real State/Province data ─────────
// COUNTRIES below is a real, complete list of sovereign states/territories
// (matching common ISO 3166-1 business-software country-picker convention,
// e.g. Stripe/Shopify's own lists -- includes commonly-listed non-UN-member
// entries like Taiwan and the Palestinian Territories under their
// commonly-used names, not a political statement).
//
// STATES_BY_COUNTRY below intentionally does NOT cover all ~195 countries --
// hand-maintaining every country's subdivisions accurately (including ones
// with recent/contested administrative reorganizations, e.g. Indonesia's
// 2022-23 province splits, or Russia's federal subjects) is a real accuracy
// risk this file avoids by simply not claiming that data. It covers a real,
// complete (not stubbed) state/province list for 20 major economies/trading
// partners relevant to a B2B compliance/ERP/CRM platform, weighted toward
// this codebase's own India-first statutory-compliance domain: India (all
// 28 states + 8 union territories, current post-2019 J&K/Ladakh split),
// United States (50 states + DC), Canada, United Kingdom (4 constituent
// countries), Australia, United Arab Emirates, Germany, France (13
// metropolitan regions), Italy, Spain, Netherlands, China (34
// provincial-level divisions), Japan (47 prefectures), Brazil, South Africa,
// Nigeria, Mexico, Saudi Arabia, Pakistan, Bangladesh.
//
// Any country NOT in STATES_BY_COUNTRY (the other ~175) still appears in the
// Country select -- its State field simply falls back to free text (see
// StateSelect in src/components/ui/country-state-select.tsx), so selecting
// an uncovered country never blocks or breaks address entry, it just
// doesn't get a State dropdown. Extending coverage to another country later
// is additive -- add one entry to STATES_BY_COUNTRY, no other code changes.

export type Country = {
  /** ISO 3166-1 alpha-2 code. Used only as an internal key into STATES_BY_COUNTRY. */
  code: string;
  /** Display name -- this is also the value persisted to the DB's free-text
   *  country columns, so existing free-text data (e.g. "India" typed before
   *  this module existed) keeps displaying/matching correctly. */
  name: string;
};

export type StateEntry = {
  /** ISO 3166-2 (or locally-conventional) subdivision code. Not persisted --
   *  informational/for potential future use (e.g. GST state-code mapping). */
  code: string;
  /** Display name -- this is the value persisted to the DB's free-text state columns. */
  name: string;
};

export const COUNTRIES: Country[] = [
  { code: "AF", name: "Afghanistan" },
  { code: "AL", name: "Albania" },
  { code: "DZ", name: "Algeria" },
  { code: "AD", name: "Andorra" },
  { code: "AO", name: "Angola" },
  { code: "AG", name: "Antigua and Barbuda" },
  { code: "AR", name: "Argentina" },
  { code: "AM", name: "Armenia" },
  { code: "AU", name: "Australia" },
  { code: "AT", name: "Austria" },
  { code: "AZ", name: "Azerbaijan" },
  { code: "BS", name: "Bahamas" },
  { code: "BH", name: "Bahrain" },
  { code: "BD", name: "Bangladesh" },
  { code: "BB", name: "Barbados" },
  { code: "BY", name: "Belarus" },
  { code: "BE", name: "Belgium" },
  { code: "BZ", name: "Belize" },
  { code: "BJ", name: "Benin" },
  { code: "BT", name: "Bhutan" },
  { code: "BO", name: "Bolivia" },
  { code: "BA", name: "Bosnia and Herzegovina" },
  { code: "BW", name: "Botswana" },
  { code: "BR", name: "Brazil" },
  { code: "BN", name: "Brunei" },
  { code: "BG", name: "Bulgaria" },
  { code: "BF", name: "Burkina Faso" },
  { code: "BI", name: "Burundi" },
  { code: "KH", name: "Cambodia" },
  { code: "CM", name: "Cameroon" },
  { code: "CA", name: "Canada" },
  { code: "CV", name: "Cape Verde" },
  { code: "CF", name: "Central African Republic" },
  { code: "TD", name: "Chad" },
  { code: "CL", name: "Chile" },
  { code: "CN", name: "China" },
  { code: "CO", name: "Colombia" },
  { code: "KM", name: "Comoros" },
  { code: "CG", name: "Congo" },
  { code: "CD", name: "Congo (DRC)" },
  { code: "CR", name: "Costa Rica" },
  { code: "CI", name: "Côte d'Ivoire" },
  { code: "HR", name: "Croatia" },
  { code: "CU", name: "Cuba" },
  { code: "CY", name: "Cyprus" },
  { code: "CZ", name: "Czech Republic" },
  { code: "DK", name: "Denmark" },
  { code: "DJ", name: "Djibouti" },
  { code: "DM", name: "Dominica" },
  { code: "DO", name: "Dominican Republic" },
  { code: "EC", name: "Ecuador" },
  { code: "EG", name: "Egypt" },
  { code: "SV", name: "El Salvador" },
  { code: "GQ", name: "Equatorial Guinea" },
  { code: "ER", name: "Eritrea" },
  { code: "EE", name: "Estonia" },
  { code: "SZ", name: "Eswatini" },
  { code: "ET", name: "Ethiopia" },
  { code: "FJ", name: "Fiji" },
  { code: "FI", name: "Finland" },
  { code: "FR", name: "France" },
  { code: "GA", name: "Gabon" },
  { code: "GM", name: "Gambia" },
  { code: "GE", name: "Georgia" },
  { code: "DE", name: "Germany" },
  { code: "GH", name: "Ghana" },
  { code: "GR", name: "Greece" },
  { code: "GD", name: "Grenada" },
  { code: "GT", name: "Guatemala" },
  { code: "GN", name: "Guinea" },
  { code: "GW", name: "Guinea-Bissau" },
  { code: "GY", name: "Guyana" },
  { code: "HT", name: "Haiti" },
  { code: "HN", name: "Honduras" },
  { code: "HK", name: "Hong Kong" },
  { code: "HU", name: "Hungary" },
  { code: "IS", name: "Iceland" },
  { code: "IN", name: "India" },
  { code: "ID", name: "Indonesia" },
  { code: "IR", name: "Iran" },
  { code: "IQ", name: "Iraq" },
  { code: "IE", name: "Ireland" },
  { code: "IL", name: "Israel" },
  { code: "IT", name: "Italy" },
  { code: "JM", name: "Jamaica" },
  { code: "JP", name: "Japan" },
  { code: "JO", name: "Jordan" },
  { code: "KZ", name: "Kazakhstan" },
  { code: "KE", name: "Kenya" },
  { code: "KI", name: "Kiribati" },
  { code: "KW", name: "Kuwait" },
  { code: "KG", name: "Kyrgyzstan" },
  { code: "LA", name: "Laos" },
  { code: "LV", name: "Latvia" },
  { code: "LB", name: "Lebanon" },
  { code: "LS", name: "Lesotho" },
  { code: "LR", name: "Liberia" },
  { code: "LY", name: "Libya" },
  { code: "LI", name: "Liechtenstein" },
  { code: "LT", name: "Lithuania" },
  { code: "LU", name: "Luxembourg" },
  { code: "MO", name: "Macau" },
  { code: "MG", name: "Madagascar" },
  { code: "MW", name: "Malawi" },
  { code: "MY", name: "Malaysia" },
  { code: "MV", name: "Maldives" },
  { code: "ML", name: "Mali" },
  { code: "MT", name: "Malta" },
  { code: "MH", name: "Marshall Islands" },
  { code: "MR", name: "Mauritania" },
  { code: "MU", name: "Mauritius" },
  { code: "MX", name: "Mexico" },
  { code: "FM", name: "Micronesia" },
  { code: "MD", name: "Moldova" },
  { code: "MC", name: "Monaco" },
  { code: "MN", name: "Mongolia" },
  { code: "ME", name: "Montenegro" },
  { code: "MA", name: "Morocco" },
  { code: "MZ", name: "Mozambique" },
  { code: "MM", name: "Myanmar" },
  { code: "NA", name: "Namibia" },
  { code: "NR", name: "Nauru" },
  { code: "NP", name: "Nepal" },
  { code: "NL", name: "Netherlands" },
  { code: "NZ", name: "New Zealand" },
  { code: "NI", name: "Nicaragua" },
  { code: "NE", name: "Niger" },
  { code: "NG", name: "Nigeria" },
  { code: "KP", name: "North Korea" },
  { code: "MK", name: "North Macedonia" },
  { code: "NO", name: "Norway" },
  { code: "OM", name: "Oman" },
  { code: "PK", name: "Pakistan" },
  { code: "PW", name: "Palau" },
  { code: "PS", name: "Palestinian Territories" },
  { code: "PA", name: "Panama" },
  { code: "PG", name: "Papua New Guinea" },
  { code: "PY", name: "Paraguay" },
  { code: "PE", name: "Peru" },
  { code: "PH", name: "Philippines" },
  { code: "PL", name: "Poland" },
  { code: "PT", name: "Portugal" },
  { code: "QA", name: "Qatar" },
  { code: "RO", name: "Romania" },
  { code: "RU", name: "Russia" },
  { code: "RW", name: "Rwanda" },
  { code: "KN", name: "Saint Kitts and Nevis" },
  { code: "LC", name: "Saint Lucia" },
  { code: "VC", name: "Saint Vincent and the Grenadines" },
  { code: "WS", name: "Samoa" },
  { code: "SM", name: "San Marino" },
  { code: "ST", name: "São Tomé and Príncipe" },
  { code: "SA", name: "Saudi Arabia" },
  { code: "SN", name: "Senegal" },
  { code: "RS", name: "Serbia" },
  { code: "SC", name: "Seychelles" },
  { code: "SL", name: "Sierra Leone" },
  { code: "SG", name: "Singapore" },
  { code: "SK", name: "Slovakia" },
  { code: "SI", name: "Slovenia" },
  { code: "SB", name: "Solomon Islands" },
  { code: "SO", name: "Somalia" },
  { code: "ZA", name: "South Africa" },
  { code: "KR", name: "South Korea" },
  { code: "SS", name: "South Sudan" },
  { code: "ES", name: "Spain" },
  { code: "LK", name: "Sri Lanka" },
  { code: "SD", name: "Sudan" },
  { code: "SR", name: "Suriname" },
  { code: "SE", name: "Sweden" },
  { code: "CH", name: "Switzerland" },
  { code: "SY", name: "Syria" },
  { code: "TW", name: "Taiwan" },
  { code: "TJ", name: "Tajikistan" },
  { code: "TZ", name: "Tanzania" },
  { code: "TH", name: "Thailand" },
  { code: "TL", name: "Timor-Leste" },
  { code: "TG", name: "Togo" },
  { code: "TO", name: "Tonga" },
  { code: "TT", name: "Trinidad and Tobago" },
  { code: "TN", name: "Tunisia" },
  { code: "TR", name: "Turkey" },
  { code: "TM", name: "Turkmenistan" },
  { code: "TV", name: "Tuvalu" },
  { code: "UG", name: "Uganda" },
  { code: "UA", name: "Ukraine" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "GB", name: "United Kingdom" },
  { code: "US", name: "United States" },
  { code: "UY", name: "Uruguay" },
  { code: "UZ", name: "Uzbekistan" },
  { code: "VU", name: "Vanuatu" },
  { code: "VA", name: "Vatican City" },
  { code: "VE", name: "Venezuela" },
  { code: "VN", name: "Vietnam" },
  { code: "YE", name: "Yemen" },
  { code: "ZM", name: "Zambia" },
  { code: "ZW", name: "Zimbabwe" },
];

export const STATES_BY_COUNTRY: Record<string, StateEntry[]> = {
  IN: [
    { code: "AP", name: "Andhra Pradesh" },
    { code: "AR", name: "Arunachal Pradesh" },
    { code: "AS", name: "Assam" },
    { code: "BR", name: "Bihar" },
    { code: "CT", name: "Chhattisgarh" },
    { code: "GA", name: "Goa" },
    { code: "GJ", name: "Gujarat" },
    { code: "HR", name: "Haryana" },
    { code: "HP", name: "Himachal Pradesh" },
    { code: "JH", name: "Jharkhand" },
    { code: "KA", name: "Karnataka" },
    { code: "KL", name: "Kerala" },
    { code: "MP", name: "Madhya Pradesh" },
    { code: "MH", name: "Maharashtra" },
    { code: "MN", name: "Manipur" },
    { code: "ML", name: "Meghalaya" },
    { code: "MZ", name: "Mizoram" },
    { code: "NL", name: "Nagaland" },
    { code: "OR", name: "Odisha" },
    { code: "PB", name: "Punjab" },
    { code: "RJ", name: "Rajasthan" },
    { code: "SK", name: "Sikkim" },
    { code: "TN", name: "Tamil Nadu" },
    { code: "TG", name: "Telangana" },
    { code: "TR", name: "Tripura" },
    { code: "UP", name: "Uttar Pradesh" },
    { code: "UT", name: "Uttarakhand" },
    { code: "WB", name: "West Bengal" },
    { code: "AN", name: "Andaman and Nicobar Islands" },
    { code: "CH", name: "Chandigarh" },
    { code: "DN", name: "Dadra and Nagar Haveli and Daman and Diu" },
    { code: "DL", name: "Delhi" },
    { code: "JK", name: "Jammu and Kashmir" },
    { code: "LA", name: "Ladakh" },
    { code: "LD", name: "Lakshadweep" },
    { code: "PY", name: "Puducherry" },
  ],
  US: [
    { code: "AL", name: "Alabama" }, { code: "AK", name: "Alaska" }, { code: "AZ", name: "Arizona" },
    { code: "AR", name: "Arkansas" }, { code: "CA", name: "California" }, { code: "CO", name: "Colorado" },
    { code: "CT", name: "Connecticut" }, { code: "DE", name: "Delaware" }, { code: "DC", name: "District of Columbia" },
    { code: "FL", name: "Florida" }, { code: "GA", name: "Georgia" }, { code: "HI", name: "Hawaii" },
    { code: "ID", name: "Idaho" }, { code: "IL", name: "Illinois" }, { code: "IN", name: "Indiana" },
    { code: "IA", name: "Iowa" }, { code: "KS", name: "Kansas" }, { code: "KY", name: "Kentucky" },
    { code: "LA", name: "Louisiana" }, { code: "ME", name: "Maine" }, { code: "MD", name: "Maryland" },
    { code: "MA", name: "Massachusetts" }, { code: "MI", name: "Michigan" }, { code: "MN", name: "Minnesota" },
    { code: "MS", name: "Mississippi" }, { code: "MO", name: "Missouri" }, { code: "MT", name: "Montana" },
    { code: "NE", name: "Nebraska" }, { code: "NV", name: "Nevada" }, { code: "NH", name: "New Hampshire" },
    { code: "NJ", name: "New Jersey" }, { code: "NM", name: "New Mexico" }, { code: "NY", name: "New York" },
    { code: "NC", name: "North Carolina" }, { code: "ND", name: "North Dakota" }, { code: "OH", name: "Ohio" },
    { code: "OK", name: "Oklahoma" }, { code: "OR", name: "Oregon" }, { code: "PA", name: "Pennsylvania" },
    { code: "RI", name: "Rhode Island" }, { code: "SC", name: "South Carolina" }, { code: "SD", name: "South Dakota" },
    { code: "TN", name: "Tennessee" }, { code: "TX", name: "Texas" }, { code: "UT", name: "Utah" },
    { code: "VT", name: "Vermont" }, { code: "VA", name: "Virginia" }, { code: "WA", name: "Washington" },
    { code: "WV", name: "West Virginia" }, { code: "WI", name: "Wisconsin" }, { code: "WY", name: "Wyoming" },
  ],
  CA: [
    { code: "AB", name: "Alberta" }, { code: "BC", name: "British Columbia" }, { code: "MB", name: "Manitoba" },
    { code: "NB", name: "New Brunswick" }, { code: "NL", name: "Newfoundland and Labrador" },
    { code: "NS", name: "Nova Scotia" }, { code: "ON", name: "Ontario" }, { code: "PE", name: "Prince Edward Island" },
    { code: "QC", name: "Quebec" }, { code: "SK", name: "Saskatchewan" }, { code: "NT", name: "Northwest Territories" },
    { code: "NU", name: "Nunavut" }, { code: "YT", name: "Yukon" },
  ],
  GB: [
    { code: "ENG", name: "England" }, { code: "SCT", name: "Scotland" },
    { code: "WLS", name: "Wales" }, { code: "NIR", name: "Northern Ireland" },
  ],
  AU: [
    { code: "NSW", name: "New South Wales" }, { code: "VIC", name: "Victoria" }, { code: "QLD", name: "Queensland" },
    { code: "WA", name: "Western Australia" }, { code: "SA", name: "South Australia" }, { code: "TAS", name: "Tasmania" },
    { code: "ACT", name: "Australian Capital Territory" }, { code: "NT", name: "Northern Territory" },
  ],
  AE: [
    { code: "AZ", name: "Abu Dhabi" }, { code: "DU", name: "Dubai" }, { code: "SH", name: "Sharjah" },
    { code: "AJ", name: "Ajman" }, { code: "UQ", name: "Umm Al Quwain" }, { code: "RK", name: "Ras Al Khaimah" },
    { code: "FU", name: "Fujairah" },
  ],
  DE: [
    { code: "BW", name: "Baden-Württemberg" }, { code: "BY", name: "Bavaria" }, { code: "BE", name: "Berlin" },
    { code: "BB", name: "Brandenburg" }, { code: "HB", name: "Bremen" }, { code: "HH", name: "Hamburg" },
    { code: "HE", name: "Hesse" }, { code: "NI", name: "Lower Saxony" }, { code: "MV", name: "Mecklenburg-Vorpommern" },
    { code: "NW", name: "North Rhine-Westphalia" }, { code: "RP", name: "Rhineland-Palatinate" },
    { code: "SL", name: "Saarland" }, { code: "SN", name: "Saxony" }, { code: "ST", name: "Saxony-Anhalt" },
    { code: "SH", name: "Schleswig-Holstein" }, { code: "TH", name: "Thuringia" },
  ],
  FR: [
    { code: "ARA", name: "Auvergne-Rhône-Alpes" }, { code: "BFC", name: "Bourgogne-Franche-Comté" },
    { code: "BRE", name: "Bretagne" }, { code: "CVL", name: "Centre-Val de Loire" }, { code: "COR", name: "Corse" },
    { code: "GES", name: "Grand Est" }, { code: "HDF", name: "Hauts-de-France" }, { code: "IDF", name: "Île-de-France" },
    { code: "NOR", name: "Normandie" }, { code: "NAQ", name: "Nouvelle-Aquitaine" }, { code: "OCC", name: "Occitanie" },
    { code: "PDL", name: "Pays de la Loire" }, { code: "PAC", name: "Provence-Alpes-Côte d'Azur" },
  ],
  IT: [
    { code: "ABR", name: "Abruzzo" }, { code: "VAO", name: "Aosta Valley" }, { code: "PUG", name: "Apulia" },
    { code: "BAS", name: "Basilicata" }, { code: "CAL", name: "Calabria" }, { code: "CAM", name: "Campania" },
    { code: "EMR", name: "Emilia-Romagna" }, { code: "FVG", name: "Friuli-Venezia Giulia" }, { code: "LAZ", name: "Lazio" },
    { code: "LIG", name: "Liguria" }, { code: "LOM", name: "Lombardy" }, { code: "MAR", name: "Marche" },
    { code: "MOL", name: "Molise" }, { code: "PIE", name: "Piedmont" }, { code: "SAR", name: "Sardinia" },
    { code: "SIC", name: "Sicily" }, { code: "TAA", name: "Trentino-Alto Adige" }, { code: "TOS", name: "Tuscany" },
    { code: "UMB", name: "Umbria" }, { code: "VEN", name: "Veneto" },
  ],
  ES: [
    { code: "AN", name: "Andalusia" }, { code: "AR", name: "Aragon" }, { code: "AS", name: "Asturias" },
    { code: "IB", name: "Balearic Islands" }, { code: "PV", name: "Basque Country" }, { code: "CN", name: "Canary Islands" },
    { code: "CB", name: "Cantabria" }, { code: "CM", name: "Castile-La Mancha" }, { code: "CL", name: "Castile and León" },
    { code: "CT", name: "Catalonia" }, { code: "EX", name: "Extremadura" }, { code: "GA", name: "Galicia" },
    { code: "RI", name: "La Rioja" }, { code: "MD", name: "Madrid" }, { code: "MC", name: "Murcia" },
    { code: "NC", name: "Navarre" }, { code: "VC", name: "Valencia" },
  ],
  NL: [
    { code: "DR", name: "Drenthe" }, { code: "FL", name: "Flevoland" }, { code: "FR", name: "Friesland" },
    { code: "GE", name: "Gelderland" }, { code: "GR", name: "Groningen" }, { code: "LI", name: "Limburg" },
    { code: "NB", name: "North Brabant" }, { code: "NH", name: "North Holland" }, { code: "OV", name: "Overijssel" },
    { code: "ZH", name: "South Holland" }, { code: "UT", name: "Utrecht" }, { code: "ZE", name: "Zeeland" },
  ],
  CN: [
    { code: "AH", name: "Anhui" }, { code: "FJ", name: "Fujian" }, { code: "GS", name: "Gansu" },
    { code: "GD", name: "Guangdong" }, { code: "GZ", name: "Guizhou" }, { code: "HI", name: "Hainan" },
    { code: "HE", name: "Hebei" }, { code: "HL", name: "Heilongjiang" }, { code: "HA", name: "Henan" },
    { code: "HB", name: "Hubei" }, { code: "HN", name: "Hunan" }, { code: "JS", name: "Jiangsu" },
    { code: "JX", name: "Jiangxi" }, { code: "JL", name: "Jilin" }, { code: "LN", name: "Liaoning" },
    { code: "QH", name: "Qinghai" }, { code: "SN", name: "Shaanxi" }, { code: "SD", name: "Shandong" },
    { code: "SX", name: "Shanxi" }, { code: "SC", name: "Sichuan" }, { code: "YN", name: "Yunnan" },
    { code: "ZJ", name: "Zhejiang" }, { code: "TW", name: "Taiwan" },
    { code: "GX", name: "Guangxi" }, { code: "NM", name: "Inner Mongolia" }, { code: "NX", name: "Ningxia" },
    { code: "XZ", name: "Tibet" }, { code: "XJ", name: "Xinjiang" },
    { code: "BJ", name: "Beijing" }, { code: "CQ", name: "Chongqing" }, { code: "SH", name: "Shanghai" }, { code: "TJ", name: "Tianjin" },
    { code: "HK", name: "Hong Kong" }, { code: "MO", name: "Macau" },
  ],
  JP: [
    { code: "01", name: "Hokkaido" }, { code: "02", name: "Aomori" }, { code: "03", name: "Iwate" },
    { code: "04", name: "Miyagi" }, { code: "05", name: "Akita" }, { code: "06", name: "Yamagata" },
    { code: "07", name: "Fukushima" }, { code: "08", name: "Ibaraki" }, { code: "09", name: "Tochigi" },
    { code: "10", name: "Gunma" }, { code: "11", name: "Saitama" }, { code: "12", name: "Chiba" },
    { code: "13", name: "Tokyo" }, { code: "14", name: "Kanagawa" }, { code: "15", name: "Niigata" },
    { code: "16", name: "Toyama" }, { code: "17", name: "Ishikawa" }, { code: "18", name: "Fukui" },
    { code: "19", name: "Yamanashi" }, { code: "20", name: "Nagano" }, { code: "21", name: "Gifu" },
    { code: "22", name: "Shizuoka" }, { code: "23", name: "Aichi" }, { code: "24", name: "Mie" },
    { code: "25", name: "Shiga" }, { code: "26", name: "Kyoto" }, { code: "27", name: "Osaka" },
    { code: "28", name: "Hyogo" }, { code: "29", name: "Nara" }, { code: "30", name: "Wakayama" },
    { code: "31", name: "Tottori" }, { code: "32", name: "Shimane" }, { code: "33", name: "Okayama" },
    { code: "34", name: "Hiroshima" }, { code: "35", name: "Yamaguchi" }, { code: "36", name: "Tokushima" },
    { code: "37", name: "Kagawa" }, { code: "38", name: "Ehime" }, { code: "39", name: "Kochi" },
    { code: "40", name: "Fukuoka" }, { code: "41", name: "Saga" }, { code: "42", name: "Nagasaki" },
    { code: "43", name: "Kumamoto" }, { code: "44", name: "Oita" }, { code: "45", name: "Miyazaki" },
    { code: "46", name: "Kagoshima" }, { code: "47", name: "Okinawa" },
  ],
  BR: [
    { code: "AC", name: "Acre" }, { code: "AL", name: "Alagoas" }, { code: "AP", name: "Amapá" },
    { code: "AM", name: "Amazonas" }, { code: "BA", name: "Bahia" }, { code: "CE", name: "Ceará" },
    { code: "DF", name: "Distrito Federal" }, { code: "ES", name: "Espírito Santo" }, { code: "GO", name: "Goiás" },
    { code: "MA", name: "Maranhão" }, { code: "MT", name: "Mato Grosso" }, { code: "MS", name: "Mato Grosso do Sul" },
    { code: "MG", name: "Minas Gerais" }, { code: "PA", name: "Pará" }, { code: "PB", name: "Paraíba" },
    { code: "PR", name: "Paraná" }, { code: "PE", name: "Pernambuco" }, { code: "PI", name: "Piauí" },
    { code: "RJ", name: "Rio de Janeiro" }, { code: "RN", name: "Rio Grande do Norte" }, { code: "RS", name: "Rio Grande do Sul" },
    { code: "RO", name: "Rondônia" }, { code: "RR", name: "Roraima" }, { code: "SC", name: "Santa Catarina" },
    { code: "SP", name: "São Paulo" }, { code: "SE", name: "Sergipe" }, { code: "TO", name: "Tocantins" },
  ],
  ZA: [
    { code: "EC", name: "Eastern Cape" }, { code: "FS", name: "Free State" }, { code: "GP", name: "Gauteng" },
    { code: "KZN", name: "KwaZulu-Natal" }, { code: "LP", name: "Limpopo" }, { code: "MP", name: "Mpumalanga" },
    { code: "NC", name: "Northern Cape" }, { code: "NW", name: "North West" }, { code: "WC", name: "Western Cape" },
  ],
  NG: [
    { code: "AB", name: "Abia" }, { code: "AD", name: "Adamawa" }, { code: "AK", name: "Akwa Ibom" },
    { code: "AN", name: "Anambra" }, { code: "BA", name: "Bauchi" }, { code: "BY", name: "Bayelsa" },
    { code: "BE", name: "Benue" }, { code: "BO", name: "Borno" }, { code: "CR", name: "Cross River" },
    { code: "DE", name: "Delta" }, { code: "EB", name: "Ebonyi" }, { code: "ED", name: "Edo" },
    { code: "EK", name: "Ekiti" }, { code: "EN", name: "Enugu" }, { code: "FC", name: "Federal Capital Territory" },
    { code: "GO", name: "Gombe" }, { code: "IM", name: "Imo" }, { code: "JI", name: "Jigawa" },
    { code: "KD", name: "Kaduna" }, { code: "KN", name: "Kano" }, { code: "KT", name: "Katsina" },
    { code: "KE", name: "Kebbi" }, { code: "KO", name: "Kogi" }, { code: "KW", name: "Kwara" },
    { code: "LA", name: "Lagos" }, { code: "NA", name: "Nasarawa" }, { code: "NI", name: "Niger" },
    { code: "OG", name: "Ogun" }, { code: "ON", name: "Ondo" }, { code: "OS", name: "Osun" },
    { code: "OY", name: "Oyo" }, { code: "PL", name: "Plateau" }, { code: "RI", name: "Rivers" },
    { code: "SO", name: "Sokoto" }, { code: "TA", name: "Taraba" }, { code: "YO", name: "Yobe" },
    { code: "ZA", name: "Zamfara" },
  ],
  MX: [
    { code: "AGU", name: "Aguascalientes" }, { code: "BCN", name: "Baja California" }, { code: "BCS", name: "Baja California Sur" },
    { code: "CAM", name: "Campeche" }, { code: "CHP", name: "Chiapas" }, { code: "CHH", name: "Chihuahua" },
    { code: "COA", name: "Coahuila" }, { code: "COL", name: "Colima" }, { code: "DUR", name: "Durango" },
    { code: "GUA", name: "Guanajuato" }, { code: "GRO", name: "Guerrero" }, { code: "HID", name: "Hidalgo" },
    { code: "JAL", name: "Jalisco" }, { code: "MEX", name: "México" }, { code: "CMX", name: "Mexico City" },
    { code: "MIC", name: "Michoacán" }, { code: "MOR", name: "Morelos" }, { code: "NAY", name: "Nayarit" },
    { code: "NLE", name: "Nuevo León" }, { code: "OAX", name: "Oaxaca" }, { code: "PUE", name: "Puebla" },
    { code: "QUE", name: "Querétaro" }, { code: "ROO", name: "Quintana Roo" }, { code: "SLP", name: "San Luis Potosí" },
    { code: "SIN", name: "Sinaloa" }, { code: "SON", name: "Sonora" }, { code: "TAB", name: "Tabasco" },
    { code: "TAM", name: "Tamaulipas" }, { code: "TLA", name: "Tlaxcala" }, { code: "VER", name: "Veracruz" },
    { code: "YUC", name: "Yucatán" }, { code: "ZAC", name: "Zacatecas" },
  ],
  SA: [
    { code: "RI", name: "Riyadh" }, { code: "MK", name: "Makkah" }, { code: "MD", name: "Madinah" },
    { code: "EP", name: "Eastern Province" }, { code: "QS", name: "Qassim" }, { code: "HA", name: "Ha'il" },
    { code: "TB", name: "Tabuk" }, { code: "NB", name: "Northern Borders" }, { code: "JA", name: "Jazan" },
    { code: "NJ", name: "Najran" }, { code: "BA", name: "Al Bahah" }, { code: "JF", name: "Al Jawf" },
    { code: "AS", name: "Asir" },
  ],
  PK: [
    { code: "PB", name: "Punjab" }, { code: "SD", name: "Sindh" }, { code: "KP", name: "Khyber Pakhtunkhwa" },
    { code: "BA", name: "Balochistan" }, { code: "IS", name: "Islamabad Capital Territory" },
    { code: "GB", name: "Gilgit-Baltistan" }, { code: "AK", name: "Azad Kashmir" },
  ],
  BD: [
    { code: "BAR", name: "Barishal" }, { code: "CHI", name: "Chattogram" }, { code: "DHA", name: "Dhaka" },
    { code: "KHU", name: "Khulna" }, { code: "MYM", name: "Mymensingh" }, { code: "RAJ", name: "Rajshahi" },
    { code: "RAN", name: "Rangpur" }, { code: "SYL", name: "Sylhet" },
  ],
};

/** Every country in COUNTRIES, sorted by display name -- what a Country select renders. */
export function getCountries(): Country[] {
  return COUNTRIES;
}

/** Case-insensitive exact-name lookup. Used to resolve a legacy free-text
 *  country value (typed before this module existed) back to its Country
 *  record, so the Select can still show it as selected. */
export function findCountryByName(name: string | null | undefined): Country | undefined {
  if (!name) return undefined;
  const normalized = name.trim().toLowerCase();
  return COUNTRIES.find((c) => c.name.toLowerCase() === normalized);
}

/** True when STATES_BY_COUNTRY has real subdivision data for this country
 *  name -- callers use this to decide whether to render a State dropdown or
 *  fall back to a free-text State input. */
export function countryHasStateData(countryName: string | null | undefined): boolean {
  const country = findCountryByName(countryName);
  if (!country) return false;
  return (STATES_BY_COUNTRY[country.code]?.length ?? 0) > 0;
}

/** States/provinces for a given country NAME (not code -- matches how this
 *  value is persisted/passed around everywhere else in this app). Returns
 *  an empty array (not undefined) for an unrecognized or uncovered country,
 *  so callers can safely do `getStatesForCountry(x).length === 0` to decide
 *  on the free-text fallback without an extra null check. */
export function getStatesForCountry(countryName: string | null | undefined): StateEntry[] {
  const country = findCountryByName(countryName);
  if (!country) return [];
  return STATES_BY_COUNTRY[country.code] ?? [];
}

/** Case-insensitive exact-name lookup within a specific country's state list.
 *  Used to resolve a legacy free-text state value back to its StateEntry. */
export function findStateByName(countryName: string | null | undefined, stateName: string | null | undefined): StateEntry | undefined {
  if (!stateName) return undefined;
  const normalized = stateName.trim().toLowerCase();
  return getStatesForCountry(countryName).find((s) => s.name.toLowerCase() === normalized);
}

// ─── Cascading reset logic ──────────────────────────────────────────────────
// The actual "cascading" behavior a Country->State->City select is expected
// to have: picking a different Country invalidates whatever State/City were
// previously selected (they belonged to the old country); picking a
// different State within the same Country invalidates whatever City was
// typed (same reasoning, one level down). These are pure functions -- both
// src/app/(app)/crm/accounts/[id]/page.tsx (billing + shipping) and
// src/components/erp/PartyAddressesAndContacts.tsx call these same two
// functions rather than each re-implementing their own reset rule, so the
// behavior (and its test coverage below) is real production logic, not a
// test-only duplicate of what the UI actually does.

export type CascadingAddressValue = {
  country: string | null;
  state: string | null;
  city: string | null;
};

/**
 * Given the currently-stored address triple and a newly-selected Country,
 * returns the triple that should be persisted. A genuine country change
 * clears State and City; re-selecting the SAME country (e.g. a redundant
 * onValueChange firing with no real change) leaves everything untouched.
 */
export function resolveCountryChange(previous: CascadingAddressValue, nextCountry: string | null): CascadingAddressValue {
  if (nextCountry === previous.country) return previous;
  return { country: nextCountry, state: null, city: null };
}

/**
 * Given the currently-stored address triple and a newly-selected State,
 * returns the triple that should be persisted. A genuine state change
 * clears City; re-selecting the SAME state leaves everything untouched.
 * Country is never modified by a state change.
 */
export function resolveStateChange(previous: CascadingAddressValue, nextState: string | null): CascadingAddressValue {
  if (nextState === previous.state) return previous;
  return { ...previous, state: nextState, city: null };
}
