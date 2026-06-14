// Context-relevant icons per life-domain slug, extracted from App.tsx. Anything
// not matched falls back to the diamond glyph in render so unknown domains still
// look intentional.
import {
  Award, BookOpen, Brain, Briefcase, Calendar as CalendarIcon, Compass, Crown, Eye,
  FileText, Gift, GraduationCap, Heart, Home, Mail, PenLine, Receipt, Shield,
  TrendingUp, Users, type LucideIcon,
} from "lucide-react";

export const DOMAIN_ICONS: Record<string, LucideIcon> = {
  tax: Receipt,
  taxes: Receipt,
  wealth: TrendingUp,
  finance: TrendingUp,
  finances: TrendingUp,
  health: Heart,
  fitness: Heart,
  "real-estate": Home,
  realestate: Home,
  home: Home,
  estate: Home,
  insurance: Shield,
  security: Shield,
  business: Briefcase,
  career: Briefcase,
  work: Briefcase,
  content: PenLine,
  brand: Award,
  benefits: Gift,
  calendar: CalendarIcon,
  schedule: CalendarIcon,
  vision: Eye,
  chief: Crown,
  learning: GraduationCap,
  learn: GraduationCap,
  education: GraduationCap,
  records: FileText,
  logs: FileText,
  social: Users,
  family: Users,
  intel: Brain,
  intelligence: Brain,
  explore: Compass,
  exploration: Compass,
  travel: Compass,
  research: BookOpen,
  books: BookOpen,
  reading: BookOpen,
  mail: Mail,
  email: Mail,
  inbox: Mail,
};

export function domainIcon(name: string): LucideIcon | null {
  return DOMAIN_ICONS[name.toLowerCase()] ?? null;
}
