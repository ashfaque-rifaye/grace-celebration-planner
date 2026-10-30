/**
 * Planning knowledge for each event type: how money usually splits, what has to
 * happen and when, and who needs to be booked. This is the deterministic
 * skeleton that the AI layer then personalises, so a plan always exists even
 * with no model available.
 */
import type { BudgetCategory, EventType } from "./schemas.js";

export interface BudgetTemplateLine {
  category: BudgetCategory;
  label: string;
  /** Typical share of the total, before the user's priorities are applied. */
  share: number;
}

export interface TaskTemplate {
  title: string;
  /** Ideal number of days before the event. Compressed when time is short. */
  daysBefore: number;
}

export interface VendorTemplate {
  label: string;
  category: BudgetCategory;
  /** Ideal lead time for booking, in days before the event. */
  leadDays: number;
}

export interface EventTemplate {
  label: string;
  budget: readonly BudgetTemplateLine[];
  tasks: readonly TaskTemplate[];
  vendors: readonly VendorTemplate[];
}

/** Held back from every allocation so one surprise does not derail the plan. */
export const CONTINGENCY_SHARE = 0.1;

/** What has to happen with any supplier, from first call to the day itself. */
const COMMON_VENDOR_CHECKS = [
  "Confirm they are available on your date",
  "Get a written quote with inclusions",
  "Check reviews or speak to a past client",
  "Sign the contract and read the cancellation terms",
  "Pay the deposit and keep the receipt",
  "Confirm arrival time and details one week before",
] as const;

const CATEGORY_VENDOR_CHECKS: Partial<Record<BudgetCategory, readonly string[]>> = {
  venue: ["Visit in person and check step-free access", "Confirm parking and noise curfew"],
  catering: ["Hold a tasting", "Share dietary needs and the final headcount"],
  decor: ["Approve a sample or mock-up"],
  attire: ["Book a trial or fitting"],
  photography: ["Agree the shot list and delivery date"],
  entertainment: ["Agree the playlist or set list", "Confirm their sound and power needs"],
  stationery: ["Proofread names, dates and venue before printing"],
  transport: ["Share the pick-up schedule and guest count"],
  cake: ["Confirm flavour, allergens and delivery time"],
  favours: ["Confirm quantities and delivery date"],
  permits: ["Keep copies of approvals on the day"],
  av: ["Book a sound check and confirm power on site"],
  marketing: ["Approve the artwork before printing"],
  safety: ["Share the site map and emergency plan"],
};

/** The checklist for one vendor: shared steps, plus anything specific to its kind. */
export function vendorChecklist(category: BudgetCategory | null): string[] {
  const specific = category ? (CATEGORY_VENDOR_CHECKS[category] ?? []) : [];
  const [first, ...rest] = COMMON_VENDOR_CHECKS;
  return [first, ...specific, ...rest];
}

export const EVENT_TEMPLATES: Record<EventType, EventTemplate> = {
  wedding: {
    label: "Wedding",
    budget: [
      { category: "venue", label: "Venue", share: 0.24 },
      { category: "catering", label: "Food & drink", share: 0.28 },
      { category: "decor", label: "Decor & florals", share: 0.12 },
      { category: "attire", label: "Attire & styling", share: 0.1 },
      { category: "photography", label: "Photo & video", share: 0.1 },
      { category: "entertainment", label: "Music & entertainment", share: 0.06 },
      { category: "stationery", label: "Invitations", share: 0.03 },
      { category: "transport", label: "Guest transport", share: 0.04 },
      { category: "favours", label: "Favours & gifts", share: 0.03 },
    ],
    tasks: [
      { title: "Agree the overall budget and who is paying for what", daysBefore: 270 },
      { title: "Draft the guest list and estimate headcount", daysBefore: 250 },
      { title: "Shortlist and visit venues", daysBefore: 240 },
      { title: "Set the date and pay the venue deposit", daysBefore: 210 },
      { title: "Book the photographer and videographer", daysBefore: 180 },
      { title: "Choose and book the caterer", daysBefore: 160 },
      { title: "Send save-the-dates", daysBefore: 150 },
      { title: "Choose outfits and schedule fittings", daysBefore: 120 },
      { title: "Book music and entertainment", daysBefore: 110 },
      { title: "Book decor and florals", daysBefore: 90 },
      { title: "Send invitations", daysBefore: 75 },
      { title: "Arrange guest travel and accommodation", daysBefore: 60 },
      { title: "Finalise the menu and hold a tasting", daysBefore: 45 },
      { title: "Chase RSVPs and confirm the final headcount", daysBefore: 21 },
      { title: "Build the seating plan", daysBefore: 14 },
      { title: "Confirm timings with every vendor", daysBefore: 7 },
      { title: "Pack the emergency kit and hand over final payments", daysBefore: 2 },
      { title: "Hand the run sheet to your day-of coordinator", daysBefore: 0 },
    ],
    vendors: [
      { label: "Venue", category: "venue", leadDays: 210 },
      { label: "Caterer", category: "catering", leadDays: 160 },
      { label: "Photographer & videographer", category: "photography", leadDays: 180 },
      { label: "Decorator & florist", category: "decor", leadDays: 90 },
      { label: "DJ or band", category: "entertainment", leadDays: 110 },
      { label: "Hair & makeup artist", category: "attire", leadDays: 90 },
      { label: "Invitation designer", category: "stationery", leadDays: 100 },
      { label: "Guest transport provider", category: "transport", leadDays: 45 },
    ],
  },
  birthday: {
    label: "Birthday",
    budget: [
      { category: "venue", label: "Venue", share: 0.25 },
      { category: "catering", label: "Food & drink", share: 0.32 },
      { category: "cake", label: "Cake", share: 0.07 },
      { category: "decor", label: "Decorations", share: 0.12 },
      { category: "entertainment", label: "Entertainment & activities", share: 0.15 },
      { category: "photography", label: "Photos", share: 0.05 },
      { category: "stationery", label: "Invitations", share: 0.01 },
      { category: "favours", label: "Party favours", share: 0.03 },
    ],
    tasks: [
      { title: "Pick a theme and rough guest list", daysBefore: 45 },
      { title: "Book the venue or confirm the space at home", daysBefore: 40 },
      { title: "Book entertainment or plan the activities", daysBefore: 30 },
      { title: "Send invitations", daysBefore: 25 },
      { title: "Order the cake", daysBefore: 14 },
      { title: "Plan the menu and order food and drink", daysBefore: 10 },
      { title: "Buy decorations and party favours", daysBefore: 7 },
      { title: "Chase RSVPs and confirm the headcount", daysBefore: 5 },
      { title: "Make a playlist and test the speakers", daysBefore: 3 },
      { title: "Confirm cake and food delivery times", daysBefore: 1 },
      { title: "Set up, decorate and do a final walk-through", daysBefore: 0 },
    ],
    vendors: [
      { label: "Venue", category: "venue", leadDays: 40 },
      { label: "Caterer or restaurant", category: "catering", leadDays: 21 },
      { label: "Baker", category: "cake", leadDays: 14 },
      { label: "Entertainer or DJ", category: "entertainment", leadDays: 30 },
      { label: "Decorator or balloon artist", category: "decor", leadDays: 14 },
      { label: "Photographer", category: "photography", leadDays: 21 },
    ],
  },
  community: {
    label: "Community event",
    budget: [
      { category: "venue", label: "Venue & site", share: 0.2 },
      { category: "permits", label: "Permits & insurance", share: 0.08 },
      { category: "av", label: "Sound, stage & power", share: 0.16 },
      { category: "catering", label: "Food & refreshments", share: 0.18 },
      { category: "marketing", label: "Publicity & signage", share: 0.1 },
      { category: "volunteers", label: "Volunteer support", share: 0.06 },
      { category: "safety", label: "Safety & first aid", share: 0.08 },
      { category: "entertainment", label: "Performers & activities", share: 0.08 },
      { category: "decor", label: "Decor & banners", share: 0.06 },
    ],
    tasks: [
      { title: "Form the organising committee and agree goals", daysBefore: 120 },
      { title: "Secure the venue or public-space booking", daysBefore: 100 },
      { title: "Apply for permits and check insurance", daysBefore: 90 },
      { title: "Approach sponsors and local partners", daysBefore: 80 },
      { title: "Book sound, stage and power", daysBefore: 60 },
      { title: "Recruit volunteers and name team leads", daysBefore: 50 },
      { title: "Confirm performers and activity stalls", daysBefore: 45 },
      { title: "Launch publicity across local channels", daysBefore: 40 },
      { title: "Write the safety, first-aid and access plan", daysBefore: 30 },
      { title: "Arrange food stalls and refreshments", daysBefore: 25 },
      { title: "Brief volunteers and share the shift rota", daysBefore: 7 },
      { title: "Confirm timings with all suppliers", daysBefore: 3 },
      { title: "Walk the site and put up signage", daysBefore: 1 },
      { title: "Run the volunteer briefing and open the gates", daysBefore: 0 },
    ],
    vendors: [
      { label: "Venue or local authority", category: "venue", leadDays: 100 },
      { label: "Sound, stage & power supplier", category: "av", leadDays: 60 },
      { label: "Food stalls or caterer", category: "catering", leadDays: 30 },
      { label: "First-aid provider", category: "safety", leadDays: 30 },
      { label: "Printer for banners & signage", category: "marketing", leadDays: 21 },
      { label: "Performers", category: "entertainment", leadDays: 45 },
      { label: "Event insurance provider", category: "permits", leadDays: 60 },
    ],
  },
};
