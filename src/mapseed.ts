// Map: curated best-practice stack library (the out-of-the-box seed).
//
// This is the shipped, read-only default that the Source panel suggests to any
// user. It is NOT per-user state: which tools a user actually has in which
// domain lives in the vault (data/apps/<id>/manifest.json domains[]). The seed
// is what we RECOMMEND per domain category, each tool pre-tagged with a typical
// agent-reach status, so a new user with an empty domain gets a best-practice
// stack to accept and wire up.
//
// PRIVACY CONTRACT: this file ships in the public app bundle, so it must contain
// ONLY generic, widely-known apps and neutral guidance. Never put a user's real
// accounts, identities, providers, balances, personal notes, device names, URLs,
// or plans here - that is per-user vault data, never the shipped seed.

// Canonical agent-reach status for a tool. Ordered loosely best -> worst.
//   connected  MCP/API live in this setup today
//   cli        operated via its CLI (the CLI-first preference for dev tools)
//   mcp        an official/known MCP exists, not yet connected
//   api        no MCP, but a scriptable API exists
//   research   a verified research-add: recommended, not yet adopted
//   browser    browser automation / manual web only
//   hardware   a physical device (excluded from the operability score)
//   gap        missing entirely (a hole in coverage; subtracts)
//   broken     was wired, now failing (expired token, exiting vendor)
export type ToolStatus =
  | "connected"
  | "cli"
  | "mcp"
  | "api"
  | "research"
  | "browser"
  | "hardware"
  | "gap"
  | "broken";

// How much each status counts toward a domain's agent-operable score.
// hardware is excluded from the denominator entirely (see scoreStack).
export const STATUS_WEIGHT: Record<ToolStatus, number> = {
  connected: 1,
  cli: 1,
  mcp: 0.75,
  api: 0.5,
  research: 0.5,
  browser: 0,
  broken: 0,
  gap: 0,
  hardware: 0,
};

// Short human labels for the legend + chips. No emojis; plain text only.
export const STATUS_LABEL: Record<ToolStatus, string> = {
  connected: "connected",
  cli: "CLI",
  mcp: "MCP available",
  api: "API / scriptable",
  research: "research add",
  browser: "manual / browser",
  hardware: "hardware",
  gap: "GAP",
  broken: "needs attention",
};

export interface SeedTool {
  name: string;
  status: ToolStatus;
  note?: string;
  // Which multi-account identity this tool expects, when relevant (e.g. a
  // Google-bound tool). Matches an app manifest account.label. Lets the Map
  // flag "this domain needs identity X, which is not connected".
  identity?: string;
}

export interface SeedStack {
  // Stable id for the seed stack.
  id: string;
  // Human title shown as the domain tile heading.
  label: string;
  // Domain CATEGORIES this stack attaches to. A user domain matches a seed
  // stack when its manifest `category` (or slug) is in this list. Kept as a
  // list so one stack can seed several related domains (e.g. family + estate).
  categories: string[];
  // One-line goal for the domain (from tool-stack.md).
  goal: string;
  tools: SeedTool[];
}

// The best-practice stacks. Generic, widely-known apps only (see PRIVACY
// CONTRACT above). Keep each SMALL - the most useful tools for that domain, not
// a flood. Statuses are typical reach for that kind of tool, not any user's
// actual connection state (that comes from the vault at runtime).
export const SEED_STACKS: SeedStack[] = [
  {
    id: "content",
    label: "Video & Content",
    categories: ["content", "video", "media"],
    goal: "Publish consistently across channels with less manual editing.",
    tools: [
      { name: "YouTube", status: "api" },
      { name: "ffmpeg", status: "cli" },
      { name: "yt-dlp", status: "cli" },
      { name: "HandBrake", status: "cli" },
      { name: "ElevenLabs", status: "api" },
      { name: "Canva", status: "api" },
      { name: "CapCut", status: "browser" },
      { name: "Descript", status: "browser" },
      { name: "Buffer", status: "api", note: "schedule across social channels" },
    ],
  },
  {
    id: "business",
    label: "Business",
    categories: ["business"],
    goal: "Run revenue, web presence, and books simply.",
    tools: [
      { name: "Stripe", status: "cli" },
      { name: "QuickBooks", status: "api" },
      { name: "Google Workspace", status: "api" },
      { name: "Google Analytics", status: "api" },
      { name: "Shopify", status: "api" },
      { name: "PayPal", status: "api" },
    ],
  },
  {
    id: "real-estate",
    label: "Real Estate",
    categories: ["real-estate", "realestate"],
    goal: "Operate rentals profitably with clean books.",
    tools: [
      { name: "Zillow", status: "api" },
      { name: "Redfin", status: "api" },
      { name: "Stessa", status: "api", note: "rental bookkeeping" },
      { name: "AppFolio", status: "browser", note: "property management" },
      { name: "RentCast", status: "research", note: "rent estimates + comps" },
    ],
  },
  {
    id: "wealth",
    label: "Wealth",
    categories: ["wealth", "money", "finance"],
    goal: "Grow net worth with low fees and one clear picture.",
    tools: [
      { name: "Plaid", status: "api", note: "aggregate account balances" },
      { name: "Empower", status: "api", note: "net-worth dashboard" },
      { name: "Fidelity", status: "browser" },
      { name: "Vanguard", status: "browser" },
      { name: "Charles Schwab", status: "browser" },
      { name: "YNAB", status: "api", note: "budgeting" },
      { name: "Bogleheads planning", status: "research", note: "free tax/Roth-conversion workbooks" },
    ],
  },
  {
    id: "dev",
    label: "Dev",
    categories: ["dev", "engineering"],
    goal: "Secure, portable, vendor-independent tooling. CLI first.",
    tools: [
      { name: "gh", status: "cli" },
      { name: "1Password CLI", status: "cli" },
      { name: "Tailscale", status: "cli" },
      { name: "Homebrew", status: "cli" },
      { name: "Docker", status: "cli" },
      { name: "VS Code", status: "connected" },
      { name: "Ollama", status: "cli", note: "local models" },
    ],
  },
  {
    id: "travel",
    label: "Travel",
    categories: ["travel", "explore"],
    goal: "Plan, navigate, and stay connected on trips.",
    tools: [
      { name: "Google Maps", status: "mcp" },
      { name: "AllTrails", status: "api" },
      { name: "Booking.com", status: "api" },
      { name: "Airbnb", status: "browser" },
      { name: "TripIt", status: "api", note: "itinerary in one place" },
      { name: "Airalo", status: "browser", note: "travel eSIMs" },
    ],
  },
  {
    id: "health",
    label: "Health",
    categories: ["health", "wellness"],
    goal: "Stay ahead of preventive and chronic care in one rhythm.",
    tools: [
      { name: "MyChart", status: "api", note: "records, appointments, messaging" },
      { name: "Apple Health", status: "api", note: "aggregation point" },
      { name: "MyFitnessPal", status: "api", note: "diet tracking" },
      { name: "Pharmacy portal", status: "browser", note: "refills + reminders" },
    ],
  },
  {
    id: "wearables",
    label: "Wearables",
    categories: ["wearables", "health"],
    goal: "Continuous activity + health data in one reviewable place.",
    tools: [
      { name: "Garmin Connect", status: "api" },
      { name: "Fitbit", status: "api" },
      { name: "Apple Health", status: "api", note: "aggregation point" },
      { name: "Oura", status: "api" },
    ],
  },
  {
    id: "career",
    label: "Career",
    categories: ["career", "job"],
    goal: "Grow toward the next role while keeping the current one strong.",
    tools: [
      { name: "LinkedIn", status: "browser" },
      { name: "levels.fyi", status: "browser", note: "compensation research" },
      { name: "Job board watch", status: "api", note: "alerts for target roles" },
      { name: "Personal site", status: "api", note: "portfolio / resume" },
    ],
  },
  {
    id: "family-estate",
    label: "Family & Estate",
    categories: ["family", "estate"],
    goal: "Provide for family; nothing critical left unplanned.",
    tools: [
      { name: "Shared calendar", status: "api" },
      { name: "Wise", status: "browser", note: "international transfers" },
      { name: "Term life insurance", status: "gap" },
      { name: "Will / trust", status: "gap" },
      { name: "529 plans", status: "gap" },
    ],
  },
  {
    id: "insurance",
    label: "Insurance",
    categories: ["insurance"],
    goal: "Right-sized coverage, one inventory, renewals never missed.",
    tools: [
      { name: "Auto insurance", status: "browser" },
      { name: "Home / renters insurance", status: "browser" },
      { name: "Umbrella policy", status: "browser" },
      { name: "Coverage inventory", status: "api", note: "then a renewal-watch loop" },
    ],
  },
  {
    id: "learning-intel",
    label: "Learning / Intel",
    categories: ["learning", "intel"],
    goal: "Stay broadly, deeply read; know the pulse early.",
    tools: [
      { name: "Newsletters", status: "api", note: "route to a single inbox" },
      { name: "Hacker News", status: "api" },
      { name: "arXiv", status: "api" },
      { name: "Readwise Reader", status: "browser", note: "read-later + highlights" },
    ],
  },
  {
    id: "tax",
    label: "Tax",
    categories: ["tax", "taxes"],
    goal: "File on time, minimize surprises, keep clean records.",
    tools: [
      { name: "Tax accountant", status: "browser", note: "if you use a CPA" },
      { name: "TurboTax", status: "browser" },
      { name: "IRS.gov", status: "browser", note: "payments, transcripts, Direct File" },
      { name: "State revenue portal", status: "browser" },
      { name: "Tax documents folder", status: "api", note: "one folder per tax year" },
    ],
  },
  {
    id: "productivity",
    label: "Productivity",
    categories: ["productivity"],
    goal: "One trusted system for tasks, notes, and time.",
    tools: [
      { name: "Calendar", status: "api" },
      { name: "Notion", status: "api" },
      { name: "Obsidian", status: "api", note: "local markdown notes" },
      { name: "Todoist", status: "api" },
      { name: "Raycast", status: "cli" },
    ],
  },
  {
    id: "records",
    label: "Records",
    categories: ["records"],
    goal: "Every important document filed, searchable, and backed up.",
    tools: [
      { name: "Google Drive", status: "api" },
      { name: "Dropbox", status: "api" },
      { name: "1Password", status: "cli", note: "credentials + secure documents" },
      { name: "Document index", status: "api", note: "vault convention" },
    ],
  },
  {
    id: "benefits",
    label: "Benefits",
    categories: ["benefits"],
    goal: "Get full value from employer + account benefits.",
    tools: [
      { name: "401k / retirement portal", status: "browser" },
      { name: "HSA portal", status: "browser" },
      { name: "Employer HR portal", status: "browser" },
      { name: "Open enrollment tracker", status: "api", note: "vault convention: annual" },
    ],
  },
  {
    id: "homestead",
    label: "Homestead",
    categories: ["homestead"],
    goal: "Keep the home maintained, inventoried, and providers on call.",
    tools: [
      { name: "Home maintenance schedule", status: "api", note: "vault convention: seasonal" },
      { name: "Home inventory", status: "api", note: "for insurance claims" },
      { name: "Thumbtack", status: "browser", note: "find service providers" },
      { name: "HomeZada", status: "browser" },
    ],
  },
  {
    id: "hunting",
    label: "Hunting",
    categories: ["hunting"],
    goal: "Plan legal, safe, well-scouted trips.",
    tools: [
      { name: "onX Hunt", status: "browser", note: "maps + property boundaries" },
      { name: "State DNR licensing", status: "browser", note: "licenses + regulations" },
      { name: "HuntStand", status: "browser" },
      { name: "Weather (NWS)", status: "api" },
    ],
  },
  {
    id: "civic",
    label: "Civic",
    categories: ["civic"],
    goal: "Stay registered, informed, and engaged.",
    tools: [
      { name: "Representatives lookup", status: "api", note: "USA.gov / Google Civic API" },
      { name: "Voter registration", status: "browser" },
      { name: "Local city/county portal", status: "browser" },
    ],
  },
  {
    id: "faith",
    label: "Faith",
    categories: ["faith"],
    goal: "A steady rhythm of study, prayer, and reflection.",
    tools: [
      { name: "YouVersion Bible", status: "api", note: "reading plans" },
      { name: "Blue Letter Bible", status: "api", note: "study tools" },
      { name: "Reflection journal", status: "api", note: "vault convention" },
    ],
  },
  {
    id: "growth",
    label: "Growth",
    categories: ["growth"],
    goal: "Habits, reading, and reflection that compound.",
    tools: [
      { name: "Readwise", status: "browser", note: "highlights + spaced review" },
      { name: "Headspace", status: "browser" },
      { name: "Habit tracker", status: "browser" },
      { name: "Growth journal", status: "api", note: "vault convention" },
    ],
  },
  {
    id: "time",
    label: "Time",
    categories: ["time"],
    goal: "Protect attention and see where the hours go.",
    tools: [
      { name: "Calendar", status: "api" },
      { name: "Toggl Track", status: "api", note: "time tracking" },
      { name: "RescueTime", status: "api", note: "automatic attention log" },
    ],
  },
  {
    id: "vision",
    label: "Vision",
    categories: ["vision"],
    goal: "A clear, revisited picture of where life is headed.",
    tools: [
      { name: "Vision + goals doc", status: "api", note: "vault convention: the north star" },
      { name: "Annual review", status: "api", note: "vault convention" },
    ],
  },
  {
    id: "dreams",
    label: "Dreams",
    categories: ["dreams"],
    goal: "Capture aspirations so they turn into plans.",
    tools: [
      { name: "Bucket list", status: "api", note: "vault convention" },
      { name: "Ideas journal", status: "api", note: "vault convention" },
    ],
  },
  {
    id: "general",
    label: "General",
    categories: ["general"],
    goal: "The everyday core every domain leans on.",
    tools: [
      { name: "Email", status: "api" },
      { name: "Calendar", status: "api" },
      { name: "Cloud drive", status: "api" },
      { name: "Password manager", status: "cli" },
    ],
  },
];

// Look up the seed stack that best matches a domain category or slug.
export function seedForCategory(categoryOrSlug: string): SeedStack | undefined {
  const key = categoryOrSlug.trim().toLowerCase();
  return SEED_STACKS.find((s) => s.categories.includes(key) || s.id === key);
}
