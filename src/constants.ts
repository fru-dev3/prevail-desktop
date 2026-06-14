// Pure data constants extracted from App.tsx.

export const DOMAIN_BLURBS: Record<string, string> = {
  wealth: "Your money, savings, and the path to financial freedom.",
  finance: "Your money, savings, and the path to financial freedom.",
  health: "Your energy, fitness, and long-term wellbeing.",
  fitness: "Your energy, fitness, and long-term wellbeing.",
  tax: "Filings, deadlines, and keeping more of what you earn.",
  taxes: "Filings, deadlines, and keeping more of what you earn.",
  career: "Your work, growth, and where you're headed next.",
  work: "Your work, growth, and where you're headed next.",
  business: "Your ventures, clients, and what you're building.",
  insurance: "Coverage, renewals, and protecting what matters.",
  estate: "Your legacy, documents, and looking after your people.",
  calendar: "What's coming up, and making time for what counts.",
  schedule: "What's coming up, and making time for what counts.",
  benefits: "Perks, plans, and everything your employer offers.",
  brand: "Your name, your voice, and how the world sees you.",
  content: "Ideas, posts, and the things you create.",
  "real-estate": "Property, home, and the roof over your head.",
  realestate: "Property, home, and the roof over your head.",
  home: "Your space, your projects, and daily life at home.",
  records: "Important documents, kept safe and easy to find.",
  vision: "The big picture: where you're going, and why.",
  social: "Friends, connections, and staying in touch.",
  family: "The people closest to you, and staying connected.",
  learning: "Skills, courses, and growing your mind.",
  learn: "Skills, courses, and growing your mind.",
  intel: "Research, signals, and staying in the know.",
  intelligence: "Research, signals, and staying in the know.",
  explore: "Curiosities, trips, and things worth discovering.",
  travel: "Curiosities, trips, and things worth discovering.",
  chief: "Your command center for today's priorities and what matters now.",
  mail: "Your inbox: important threads handled, noise filtered, nothing dropped.",
  email: "Your inbox: important threads handled, noise filtered, nothing dropped.",
  inbox: "Your inbox: important threads handled, noise filtered, nothing dropped.",
};
export const VENDOR_BRAND: Record<string, { hex: string; accent: string; name: string }> = {
  claude:      { hex: "#cc785c", accent: "#cc785c", name: "Anthropic Claude" },
  codex:       { hex: "#10a37f", accent: "#10a37f", name: "OpenAI Codex" },
  antigravity: { hex: "#ffffff", accent: "#4285f4", name: "Google Antigravity" },
  ollama:      { hex: "#0a0a0a", accent: "#6b7280", name: "Ollama (local)" },
  lmstudio:    { hex: "#4f46e5", accent: "#6366f1", name: "LM Studio (local)" },
  mlx:         { hex: "#1f2937", accent: "#9ca3af", name: "oMLX (local)" },
  openrouter:  { hex: "#6566f1", accent: "#6566f1", name: "OpenRouter" },
  other:       { hex: "#6b7280", accent: "#6b7280", name: "-" },
};
export const SEVERITY_ORDER: Record<string, number> = { critical: 0, warn: 1, info: 2 };
export const SEVERITY_LABEL: Record<string, string> = {
  critical: "Critical",
  warn: "Warnings",
  info: "Suggestions",
};
export const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
export const SYCOPHANCY_RE = /\b(you're absolutely right!?|you are absolutely right!?|great question!?|excellent question!?|that's a great point!?)\b\s*/gi;
export const SKILL_TOKEN_RE = /(^|\s)(\/[a-zA-Z][a-zA-Z0-9_-]*)/g;
export const DOMAIN_PALETTE = [
  "#cc785c", "#2d7fe4", "#5fae74", "#2dd4bf", "#a78bfa", "#e0823d",
  "#3fa6a0", "#c44e8a", "#7c83ff", "#6b8e23", "#d2674f", "#b8860b",
];
export const INTEGRATION_LABEL: Record<string, string> = {
  api: "Direct API", oauth: "OAuth", browser: "Browser", mcp: "MCP server", manual: "Manual drop",
};
export const AUTONOMY_LABEL: Record<string, string> = {
  "read-only": "Read only", draft: "Can draft", act: "Can act",
};
export const AUTONOMY_TINT: Record<string, string> = {
  "read-only": "#2fb87a", draft: "#d8a657", act: "#e06c75",
};
export const STATUS_TINT: Record<string, string> = { connected: "#2fb87a", expired: "#d8a657", error: "#e06c75", "not-configured": "#2fb87a" };
export const PATTERN_LABEL: Record<string, string> = { api: "API", oauth: "OAuth", cli: "CLI", browser: "Web" };
export const PATTERN_TINT: Record<string, string> = { api: "#2fb87a", oauth: "#C4A35A", cli: "#6b7cff", browser: "#9aa0a6" };
export const PATTERN_TIER: Record<string, string> = { api: "Tier A · API/MCP", oauth: "Tier B · OAuth gateway", cli: "Tier D · CLI", browser: "Tier C · browser" };
export const DOMAIN_LABEL: Record<string, string> = {
  money: "Money & Banking", credit: "Credit & Debt", investing: "Investing & Wealth",
  taxes: "Taxes & Accounting", insurance: "Insurance", realestate: "Real Estate & Home",
  health: "Health & Medical", fitness: "Fitness & Wellness", email: "Email",
  communication: "Communication", productivity: "Productivity", calendar: "Calendar",
  files: "Files & Storage", security: "Security & Identity", career: "Career & Work",
  shopping: "Shopping", travel: "Travel", smarthome: "Smart Home", social: "Social",
  media: "Media & Streaming", learning: "Learning", government: "Government & Civic",
  utilities: "Utilities", automotive: "Automotive", food: "Food & Dining",
  family: "Family & Home", giving: "Giving", legal: "Legal & Estate",
  news: "News & Research", dev: "Developer", tech: "Tech & Devices",
};
export const SOURCE_ABBR: Record<string, string> = { claude: "Cl", chatgpt: "GPT", gemini: "Gem" };
export const LOCAL_CLI_IDS = new Set(["ollama", "lmstudio", "mlx"]);
