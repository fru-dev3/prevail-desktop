// Shared nav definitions for the mode-aware app sidebar. Kept in their own
// lightweight module (data + lucide icons only) so the main-bundle Sidebar can
// render the Work and Editor navs WITHOUT importing the heavy, lazy-loaded
// WorkPanel / SettingsPanel chunks.
//
// Selecting an item dispatches an event the matching content panel listens to:
//   • Work items   → "prevail:work-section"
//   • Editor items → "prevail:settings-section"
import { Activity, Bot, Briefcase, CalendarDays, Compass, Database, Dices, FileText, Github, Inbox, Layers, Lightbulb, MessagesSquare, Network, Plug, Repeat, Scale, Settings as SettingsIcon, Shield, ShieldCheck, Sparkles, Swords, UserRound, Webhook, Wrench, Zap } from "lucide-react";

export type NavItem = { id: string; label: string; icon: typeof Database };
export type NavGroup = { heading: string; items: NavItem[] };

// Work mode — operational surfaces.
export const WORK_NAV: NavGroup[] = [
  { heading: "Board", items: [
    { id: "tasks", label: "Work board", icon: Briefcase },
    { id: "recommendations", label: "Insights", icon: Sparkles },
    { id: "spark", label: "Spark", icon: Dices },
  ]},
  { heading: "Automations", items: [
    { id: "automations", label: "Automations", icon: Repeat },
    { id: "calendar", label: "Calendar", icon: CalendarDays },
  ]},
  { heading: "Notes", items: [
    { id: "notes", label: "Notes", icon: FileText },
  ]},
];

// Editor mode — configuration.
export const EDITOR_NAV: NavGroup[] = [
  { heading: "Intelligence", items: [
    { id: "models", label: "Models", icon: Layers },
    { id: "council", label: "Council", icon: Scale },
    { id: "frameworks", label: "Frameworks", icon: Lightbulb },
    { id: "skills", label: "Skills", icon: Sparkles },
    { id: "benchmark", label: "Arena", icon: Swords },
  ]},
  { heading: "Context & Memory", items: [
    { id: "ideal-state", label: "Ideals", icon: Compass },
    { id: "intents", label: "Intents", icon: Lightbulb },
    { id: "prompt-capture", label: "Prompts", icon: Inbox },
    { id: "daemons", label: "Daemons", icon: Zap },
    { id: "activity", label: "Activity", icon: Activity },
  ]},
  { heading: "Connections", items: [
    { id: "connectors", label: "Apps", icon: Plug },
    { id: "gateway", label: "Gateway", icon: MessagesSquare },
    { id: "mcp", label: "MCP", icon: Wrench },
    { id: "hooks", label: "Hooks", icon: Webhook },
    { id: "remote", label: "Network", icon: Network },
  ]},
  { heading: "Privacy & Safety", items: [
    { id: "autonomy", label: "Autonomy", icon: Bot },
    { id: "privacy", label: "Privacy", icon: ShieldCheck },
    { id: "safety", label: "Safety", icon: Shield },
  ]},
  { heading: "Settings", items: [
    { id: "profiles", label: "Profiles", icon: UserRound },
    { id: "workspace", label: "Vault", icon: Database },
    { id: "general", label: "General", icon: SettingsIcon },
    { id: "about", label: "About", icon: Github },
  ]},
];
