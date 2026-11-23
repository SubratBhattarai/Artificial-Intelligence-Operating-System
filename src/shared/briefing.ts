/** Contracts for the Daily Briefing. Everything in it is built by ordinary code, never by the model. */

export interface BriefingSection {
  id: 'schedule' | 'mail' | 'weather' | 'news' | 'deadlines' | 'reminders' | 'tasks';
  title: string;
  lines: string[];
  /** Why the section is empty: a permission is off, or a lookup failed. */
  unavailable?: string;
}

export interface Briefing {
  generatedAt: number;
  /** YYYY-MM-DD in local time. */
  day: string;
  greeting: string;
  sections: BriefingSection[];
  /** What JARVIS reads aloud, one short paragraph per section. */
  spoken: string[];
}

export interface BriefingSettings {
  /** Place name for the forecast. Empty = skip weather. */
  city: string;
  units: 'imperial' | 'metric';
  /** Public RSS/Atom feeds for headlines (https only). */
  feeds: string[];
  /** Offer the briefing once a day when AI OS opens. */
  atLaunch: boolean;
  /** Local day the launch briefing was last offered. */
  lastLaunchDay: string;
}

export const DEFAULT_BRIEFING_SETTINGS: BriefingSettings = {
  city: '',
  units: 'imperial',
  feeds: ['https://feeds.bbci.co.uk/news/rss.xml'],
  atLaunch: true,
  lastLaunchDay: '',
};
