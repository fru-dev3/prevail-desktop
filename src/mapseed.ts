// Map: curated best-practice stack library (the out-of-the-box seed).
//
// This is the shipped, read-only default that the Map panel suggests to any
// user. It is NOT per-user state: which tools a user actually has in which
// domain lives in the vault (data/apps/<id>/manifest.json domains[]). The seed
// is what we RECOMMEND per domain category, each tool pre-tagged with how
// agent-operable it is, so a new user with an empty domain gets a best-practice
// stack to accept and wire up.
//
// Source of truth for the human-readable version is the vault's
// data/domains/general/source/tool-stack.md; this file is the structured seed
// derived from it (reviewed + approved 2026-07-17). Keep them in step when the
// stack changes.

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

// The best-practice stacks. The first 12 are transcribed from the approved Map
// prototype; the rest are canonical small stacks so no domain shows up blank.
// Keep each SMALL - the most important tools for that domain, not a flood.
export const SEED_STACKS: SeedStack[] = [
  {
    id: "content",
    label: "Video & Content",
    categories: ["content", "video", "media"],
    goal: "Best-in-class videos across channels with analytics-driven topics and minimal manual touch.",
    tools: [
      { name: "YouTube channel A", status: "api", note: "youtube.com" },
      { name: "YouTube channel B", status: "api", note: "youtube.com" },
      { name: "YouTube channel C", status: "api", note: "youtube.com" },
      { name: "ffmpeg pipelines x3", status: "cli", note: "one pipeline per channel, never cross-reuse" },
      { name: "Higgsfield", status: "api" },
      { name: "fal.ai", status: "api" },
      { name: "ElevenLabs", status: "api" },
      { name: "Suno", status: "api" },
      { name: "Canva", status: "connected" },
      { name: "Excalidraw", status: "api" },
      { name: "Beehiiv", status: "api" },
      { name: "Pexels", status: "api" },
      { name: "Unsplash", status: "api" },
      { name: "Opus Clip", status: "api" },
      { name: "HandBrake", status: "cli" },
      { name: "yt-dlp", status: "cli" },
      { name: "vidIQ", status: "browser" },
      { name: "Descript", status: "browser" },
      { name: "Medium", status: "browser" },
      { name: "LinkedIn", status: "browser" },
      { name: "Screen Studio", status: "research", note: "macOS auto-zoom screen recorder for tutorials" },
      { name: "1of10", status: "research", note: "outlier-data thumbnails/titles; no API, manual exception" },
      { name: "USB microphone", status: "hardware" },
      { name: "SoundSource", status: "hardware" },
      { name: "Audio interface", status: "hardware" },
      { name: "Voice recorder", status: "hardware", note: "whole-life recorder; captures flow into the vault" },
      { name: "Action camera", status: "hardware" },
    ],
  },
  {
    id: "business",
    label: "Business",
    categories: ["business"],
    goal: "Run the LLC revenue and web presence cheaply and simply; retire QuickBooks.",
    tools: [
      { name: "Stripe", status: "cli" },
      { name: "Netlify", status: "cli" },
      { name: "Google Workspace", status: "connected", identity: "user@example.com" },
      { name: "PostHog", status: "connected" },
      { name: "PayPal", status: "connected" },
      { name: "Gumroad", status: "api" },
      { name: "GoDaddy", status: "api" },
      { name: "Google Analytics", status: "api" },
      { name: "Lili", status: "browser" },
      { name: "QuickBooks", status: "broken", note: "token expired; retiring - pick Lili bookkeeping or Wave first" },
      { name: "Polar", status: "research", note: "merchant-of-record Gumroad replacement candidate, dev-first API" },
    ],
  },
  {
    id: "real-estate",
    label: "Real Estate",
    categories: ["real-estate", "realestate"],
    goal: "Profitable, compliant, low-touch operation of the rentals; clean books.",
    tools: [
      { name: "AppFolio", status: "browser", note: "via Property manager" },
      { name: "Property manager", status: "browser" },
      { name: "Google Sheets/Drive", status: "connected", identity: "account2@example.com" },
      { name: "Credit union", status: "browser" },
      { name: "Stessa", status: "api" },
      { name: "Zillow", status: "api" },
      { name: "Redfin", status: "api" },
      { name: "MN tax portal + SOS", status: "api" },
      { name: "Lili account #2", status: "gap", note: "planned rent landing zone, not yet opened" },
      { name: "RentCast", status: "research", note: "rent AVMs + comps, free tier, first-party MCP" },
    ],
  },
  {
    id: "wealth",
    label: "Wealth",
    categories: ["wealth", "money", "finance"],
    goal: "Grow net worth with minimal fees, clean entity separation, and a full computable picture.",
    tools: [
      { name: "Fidelity", status: "browser" },
      { name: "Betterment", status: "browser" },
      { name: "US Bank", status: "browser" },
      { name: "Wells Fargo", status: "browser" },
      { name: "Bank of America", status: "browser", note: "open, zero balance" },
      { name: "Chime", status: "browser", note: "dormant" },
      { name: "Amex", status: "browser" },
      { name: "Chase", status: "browser" },
      { name: "Credit union", status: "browser" },
      { name: "Brokerage", status: "broken", note: "legacy account" },
      { name: "PayPal", status: "connected" },
      { name: "Tax accountant", status: "browser", note: "tax filing" },
      { name: "Empower", status: "api" },
      { name: "Plaid", status: "api" },
      { name: "Portfolio tracker", status: "research", note: "local-first open-source portfolio tracker, FIRE planner, MCP" },
      { name: "Bogleheads CSS", status: "research", note: "free tax/Roth-conversion planning workbook" },
      { name: "Finance MCP", status: "research", note: "read-write finance MCP - cloud, egress tension; candidate only" },
    ],
  },
  {
    id: "dev",
    label: "Dev",
    categories: ["dev", "engineering"],
    goal: "Secure, portable, vendor-independent infrastructure. CLI first, before MCP.",
    tools: [
      { name: "gh", status: "cli" },
      { name: "op (1Password)", status: "cli" },
      { name: "Tailscale", status: "cli" },
      { name: "Homebrew", status: "cli" },
      { name: "Netlify CLI", status: "cli" },
      { name: "Stripe CLI", status: "cli" },
      { name: "yt-dlp", status: "cli" },
      { name: "Ollama", status: "cli" },
      { name: "LM Studio", status: "cli" },
      { name: "Claude Code", status: "connected" },
      { name: "Prevail", status: "connected" },
      { name: "Excalidraw", status: "api" },
    ],
  },
  {
    id: "travel",
    label: "Travel",
    categories: ["travel", "explore"],
    goal: "Plan, navigate, stay connected, and maximize points; trips feed the explorer channel.",
    tools: [
      { name: "AllTrails", status: "connected" },
      { name: "Booking.com", status: "connected" },
      { name: "Google Maps", status: "mcp" },
      { name: "Google Flights watch", status: "api" },
      { name: "Vault trip files", status: "cli", note: "vault convention: one trip file per trip" },
      { name: "Airalo", status: "browser", note: "eSIM on iPhone 15" },
      { name: "Delta", status: "browser" },
      { name: "Hilton", status: "browser" },
      { name: "Marriott", status: "browser" },
      { name: "Garmin maps", status: "hardware" },
      { name: "Starlink", status: "hardware" },
    ],
  },
  {
    id: "health",
    label: "Health",
    categories: ["health", "wellness"],
    goal: "Stay ahead of chronic + preventive care: appointments, meds, labs in one rhythm.",
    tools: [
      { name: "Health plan", status: "browser" },
      { name: "Walgreens", status: "browser" },
      { name: "Chiropractor", status: "browser" },
      { name: "Fidelity HSA", status: "browser", note: "see Wealth" },
      { name: "MyChart", status: "api" },
      { name: "MyFitnessPal", status: "api", note: "diet tracking" },
      { name: "apple-health-mcp", status: "research", note: "agents query Apple Health exports in plain English" },
    ],
  },
  {
    id: "wearables",
    label: "Wearables",
    categories: ["wearables", "health"],
    goal: "Continuous activity + health data in one reviewable place.",
    tools: [
      { name: "Garmin Connect", status: "api" },
      { name: "Fitbit Air", status: "api" },
      { name: "Apple Health", status: "api", note: "aggregation point, iPhone 15" },
      { name: "Garmin watch", status: "hardware" },
    ],
  },
  {
    id: "career",
    label: "Career",
    categories: ["career", "job"],
    goal: "Land a frontier-AI role with heavy equity while keeping the day job strong.",
    tools: [
      { name: "LinkedIn", status: "browser" },
      { name: "levels.fyi", status: "browser" },
      { name: "example.com", status: "api", note: "public portfolio" },
      { name: "Greenhouse/Lever watch", status: "api", note: "target companies" },
      { name: "Interview prep", status: "cli", note: "career domain source/" },
    ],
  },
  {
    id: "family-estate",
    label: "Family & Estate",
    categories: ["family", "estate"],
    goal: "Protect and provide for the kids and parents; nothing critical left unplanned.",
    tools: [
      { name: "Google Calendar", status: "connected", identity: "user@example.com" },
      { name: "Remittance app", status: "browser", note: "abroad remittances - primary" },
      { name: "Wise", status: "browser", note: "abroad remittances" },
      { name: "Beneficiary audit", status: "api", note: "annual loop across Fidelity, Betterment, banks, LLCs" },
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
      { name: "Camper", status: "browser" },
      { name: "Renters", status: "browser" },
      { name: "Umbrella", status: "browser" },
      { name: "Landlord x2", status: "browser" },
      { name: "Inventory file", status: "api", note: "then renewal-watch loop" },
      { name: "Carrier unknown", status: "gap", identity: "account3", note: "in account3@ mail - needs connector or forwarded email" },
    ],
  },
  {
    id: "learning-intel",
    label: "Learning / Intel",
    categories: ["learning", "intel"],
    goal: "Know the pulse before others; stay broadly, deeply read.",
    tools: [
      { name: "Gmail newsletters", status: "connected", identity: "user@example.com", note: "user@example.com inbox" },
      { name: "Hacker News", status: "api" },
      { name: "arXiv", status: "api" },
      { name: "Intel loop", status: "api", note: "to stand up" },
      { name: "Readwise Reader", status: "browser", note: "proposed" },
    ],
  },
  {
    id: "tax",
    label: "Tax",
    categories: ["tax", "taxes"],
    goal: "File on time across W2 + entities + rentals, minimize surprises, keep records clean.",
    tools: [
      { name: "Tax accountant", status: "browser", note: "tax filing" },
      { name: "TurboTax", status: "browser" },
      { name: "IRS.gov", status: "browser", note: "payments, transcripts, Direct File" },
      { name: "MN Dept of Revenue", status: "browser" },
      { name: "Tax documents folder", status: "api", note: "vault convention: one folder per tax year" },
    ],
  },
  {
    id: "productivity",
    label: "Productivity",
    categories: ["productivity"],
    goal: "One trusted system for tasks, notes, and time so nothing is dropped.",
    tools: [
      { name: "Google Calendar", status: "connected", identity: "user@example.com" },
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
      { name: "Google Drive", status: "connected", identity: "user@example.com" },
      { name: "1Password", status: "cli", note: "credentials + secure documents" },
      { name: "Dropbox", status: "api" },
      { name: "Document index", status: "api", note: "vault convention" },
    ],
  },
  {
    id: "benefits",
    label: "Benefits",
    categories: ["benefits"],
    goal: "Get full value from employer + account benefits; nothing left on the table.",
    tools: [
      { name: "Fidelity NetBenefits", status: "browser", note: "401k / equity" },
      { name: "HSA portal", status: "browser" },
      { name: "Employer HR portal", status: "browser" },
      { name: "Open enrollment tracker", status: "api", note: "vault convention: annual" },
    ],
  },
  {
    id: "homestead",
    label: "Homestead",
    categories: ["homestead"],
    goal: "Keep the home maintained, inventoried, and service providers on call.",
    tools: [
      { name: "Home maintenance schedule", status: "api", note: "vault convention: seasonal" },
      { name: "Home inventory", status: "api", note: "for insurance claims" },
      { name: "Thumbtack", status: "browser", note: "service providers" },
      { name: "HomeZada", status: "browser" },
    ],
  },
  {
    id: "hunting",
    label: "Hunting",
    categories: ["hunting"],
    goal: "Plan legal, safe, well-scouted trips with licenses and conditions in hand.",
    tools: [
      { name: "onX Hunt", status: "browser", note: "maps + property boundaries" },
      { name: "MN DNR licensing", status: "browser", note: "licenses + regulations" },
      { name: "HuntStand", status: "browser" },
      { name: "Weather (NWS)", status: "api" },
    ],
  },
  {
    id: "civic",
    label: "Civic",
    categories: ["civic"],
    goal: "Stay registered, informed, and engaged with local and national civic life.",
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
    goal: "Deliberate personal growth: habits, reading, and reflection that compound.",
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
    goal: "Protect attention and see where the hours actually go.",
    tools: [
      { name: "Google Calendar", status: "connected", identity: "user@example.com" },
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
    goal: "Capture aspirations so they turn into plans, not just wishes.",
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
      { name: "Gmail", status: "connected", identity: "user@example.com" },
      { name: "Google Calendar", status: "connected", identity: "user@example.com" },
      { name: "Google Drive", status: "connected", identity: "user@example.com" },
      { name: "1Password", status: "cli" },
    ],
  },
];

// Look up the seed stack that best matches a domain category or slug.
export function seedForCategory(categoryOrSlug: string): SeedStack | undefined {
  const key = categoryOrSlug.trim().toLowerCase();
  return SEED_STACKS.find((s) => s.categories.includes(key) || s.id === key);
}
