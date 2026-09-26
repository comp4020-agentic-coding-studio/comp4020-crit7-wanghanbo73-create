import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { type Offering, type Selection, offerings, selections } from "./schema";

// One SQLite file is the app's whole persistent state. In production
// fly.toml points DATABASE_PATH at the machine's volume (/data), which is
// how state survives a reload and a redeploy; locally it defaults to an
// untracked file in .data/.
const path = process.env.DATABASE_PATH ?? "./.data/app.db";
mkdirSync(dirname(path), { recursive: true });

const client = new Database(path);
client.pragma("journal_mode = WAL");

export const db = drizzle(client);

// Migrations run at boot, on whatever machine holds the volume — the
// recommended shape for SQLite on Fly, where there's no separate machine to
// run them from. The flow: edit src/lib/schema.ts, `pnpm db:generate`,
// commit the migration it writes to drizzle/.
migrate(db, { migrationsFolder: "./drizzle" });

export type { Offering, Selection };

const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri"];

function byDayThenTime(a: Offering, b: Offering): number {
  const dayDiff = DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day);
  return dayDiff !== 0 ? dayDiff : a.startTime.localeCompare(b.startTime);
}

export function listOfferings(): Offering[] {
  return db.select().from(offerings).all().sort(byDayThenTime);
}

// The catalogue is fixed seed data, not something the app writes to at
// runtime — this is the closest thing to the real ANU timetable a
// one-week prototype gets. Guarded by an emptiness check because it runs on
// every boot (including each spec run, which starts from a fresh database).
export function seedOfferingsIfEmpty(): void {
  if (listOfferings().length > 0) return;

  db.insert(offerings)
    .values([
      { courseCode: "COMP4020", sessionType: "Lecture", day: "Mon", startTime: "10:00", endTime: "11:00", location: "Kambri" },
      // deliberately overlaps the lecture above, so a clash is reachable
      // without needing an admin UI to create one
      { courseCode: "COMP4020", sessionType: "Tutorial", day: "Mon", startTime: "10:30", endTime: "11:30", location: "CSIT N101" },
      { courseCode: "COMP2100", sessionType: "Lecture", day: "Tue", startTime: "09:00", endTime: "10:00", location: "Manning Clark" },
      { courseCode: "COMP2100", sessionType: "Lab", day: "Tue", startTime: "14:00", endTime: "16:00", location: "CSIT N103" },
      { courseCode: "COMP3600", sessionType: "Lecture", day: "Wed", startTime: "13:00", endTime: "14:00", location: "Marie Reay" },
      { courseCode: "COMP4020", sessionType: "Studio", day: "Wed", startTime: "15:30", endTime: "17:00", location: "Marie Reay 4.03" },
      { courseCode: "COMP1100", sessionType: "Lecture", day: "Thu", startTime: "11:00", endTime: "12:00", location: "Coombs" },
    ])
    .run();
}

export interface TimetableEntry {
  selectionId: number;
  offering: Offering;
}

export function listSelections(): TimetableEntry[] {
  return db
    .select({ selectionId: selections.id, offering: offerings })
    .from(selections)
    .innerJoin(offerings, eq(selections.offeringId, offerings.id))
    .all()
    .sort((a, b) => byDayThenTime(a.offering, b.offering));
}

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && bStart < aEnd;
}

// The core rule this prototype exists to enforce: two sessions on the same
// day whose time ranges overlap can't both be on the timetable. Returns the
// existing offering that a candidate would clash with, or null if it's clear.
export function findClash(candidate: Offering): Offering | null {
  const existing = listSelections();
  for (const entry of existing) {
    if (entry.offering.day !== candidate.day) continue;
    if (entry.offering.id === candidate.id) continue;
    if (overlaps(candidate.startTime, candidate.endTime, entry.offering.startTime, entry.offering.endTime)) {
      return entry.offering;
    }
  }
  return null;
}

export type AddSelectionResult =
  | { ok: true; entry: TimetableEntry }
  | { ok: false; reason: "not-found" }
  | { ok: false; reason: "clash"; clash: Offering };

export function addSelection(offeringId: number): AddSelectionResult {
  const offering = db.select().from(offerings).where(eq(offerings.id, offeringId)).get();
  if (!offering) return { ok: false, reason: "not-found" };

  const clash = findClash(offering);
  if (clash) return { ok: false, reason: "clash", clash };

  const selection = db.insert(selections).values({ offeringId }).returning().get();
  return { ok: true, entry: { selectionId: selection.id, offering } };
}

seedOfferingsIfEmpty();
