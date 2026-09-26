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
      // id 1 — COMP4020's one lecture stream
      { courseCode: "COMP4020", sessionType: "Lecture", day: "Mon", startTime: "10:00", endTime: "11:00", location: "Kambri" },
      // id 2, 3 — two lab time options for COMP4020; a student picks one
      { courseCode: "COMP4020", sessionType: "Lab", day: "Mon", startTime: "14:00", endTime: "15:30", location: "CSIT N101" },
      { courseCode: "COMP4020", sessionType: "Lab", day: "Wed", startTime: "09:00", endTime: "10:30", location: "CSIT N101" },
      // id 4 — COMP2100's lecture; overlaps nothing, added mainly as filler
      { courseCode: "COMP2100", sessionType: "Lecture", day: "Tue", startTime: "09:00", endTime: "10:00", location: "Manning Clark" },
      // id 5, 6 — two lab time options for COMP2100. Option A (id 5) lands on
      // the exact same slot as COMP4020's lab option A (id 2) — this is the
      // reachable clash demo: two Labs from different courses overlapping.
      { courseCode: "COMP2100", sessionType: "Lab", day: "Mon", startTime: "14:00", endTime: "15:30", location: "CSIT N103" },
      { courseCode: "COMP2100", sessionType: "Lab", day: "Thu", startTime: "13:00", endTime: "15:00", location: "CSIT N103" },
      // id 7 — COMP3600's lecture
      { courseCode: "COMP3600", sessionType: "Lecture", day: "Wed", startTime: "13:00", endTime: "14:00", location: "Marie Reay" },
      // id 8 — a lab that overlaps COMP4020's lab option B (id 3), same day,
      // different course — a second reachable lab-vs-lab clash
      { courseCode: "COMP3600", sessionType: "Lab", day: "Wed", startTime: "09:30", endTime: "11:00", location: "Marie Reay Lab" },
      // id 9 — a non-lab session type; never clashes, same as Lecture
      { courseCode: "COMP4020", sessionType: "Studio", day: "Wed", startTime: "15:30", endTime: "17:00", location: "Marie Reay 4.03" },
      // id 10 — a second lecture stream that overlaps id 1's slot exactly,
      // different course: proves lectures never clash even when they overlap
      { courseCode: "COMP1100", sessionType: "Lecture", day: "Mon", startTime: "10:15", endTime: "10:45", location: "Melville Hall" },
      // id 11 — COMP1100's normal lecture slot, clashes with nothing
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

// The core rule this prototype exists to enforce: Lab sessions have limited,
// timetabled slots that genuinely compete for the same room and hour, so two
// overlapping Labs can't both be on the timetable, regardless of course.
// Lectures (and Tutorials/Studios) are broadcast to everyone enrolled — two
// of them overlapping isn't a real-world conflict, so they never clash, even
// against each other. Returns the existing offering a candidate Lab would
// clash with, or null if it's clear or the candidate isn't a Lab at all.
// `ignoreOfferingId` skips one existing selection from clash consideration —
// used by addSelection when a course's existing Lab is about to be replaced
// by another Lab option for the same course, so the outgoing one shouldn't
// count as a clash against the incoming one.
export function findClash(candidate: Offering, ignoreOfferingId?: number): Offering | null {
  if (candidate.sessionType !== "Lab") return null;

  const existing = listSelections();
  for (const entry of existing) {
    if (entry.offering.sessionType !== "Lab") continue;
    if (entry.offering.day !== candidate.day) continue;
    if (entry.offering.id === candidate.id) continue;
    if (entry.offering.id === ignoreOfferingId) continue;
    if (overlaps(candidate.startTime, candidate.endTime, entry.offering.startTime, entry.offering.endTime)) {
      return entry.offering;
    }
  }
  return null;
}

export type AddSelectionResult =
  | { ok: true; entry: TimetableEntry; replaced: TimetableEntry | null }
  | { ok: false; reason: "not-found" }
  | { ok: false; reason: "clash"; clash: Offering };

// A course only ever needs (at most) one Lab, so picking a different Lab
// option for a course that already has one swaps it out rather than sitting
// alongside it — without this, two Lab options for the same course that
// don't happen to overlap in time (a common case, since they're usually on
// different days) would both silently end up on the timetable at once.
export function addSelection(offeringId: number): AddSelectionResult {
  const offering = db.select().from(offerings).where(eq(offerings.id, offeringId)).get();
  if (!offering) return { ok: false, reason: "not-found" };

  const existingLabForCourse =
    offering.sessionType === "Lab"
      ? (listSelections().find(
          (entry) =>
            entry.offering.sessionType === "Lab" &&
            entry.offering.courseCode === offering.courseCode,
        ) ?? null)
      : null;

  const clash = findClash(offering, existingLabForCourse?.offering.id);
  if (clash) return { ok: false, reason: "clash", clash };

  if (existingLabForCourse) {
    db.delete(selections).where(eq(selections.id, existingLabForCourse.selectionId)).run();
  }

  const selection = db.insert(selections).values({ offeringId }).returning().get();
  return {
    ok: true,
    entry: { selectionId: selection.id, offering },
    replaced: existingLabForCourse,
  };
}

export function removeSelection(selectionId: number): TimetableEntry | null {
  const entry = db
    .select({ selectionId: selections.id, offering: offerings })
    .from(selections)
    .innerJoin(offerings, eq(selections.offeringId, offerings.id))
    .where(eq(selections.id, selectionId))
    .get();
  if (!entry) return null;

  db.delete(selections).where(eq(selections.id, selectionId)).run();
  return entry;
}

// Wipes the whole timetable in one go — the "cancel" half of one-click
// enrol, and useful on its own to start over. Returns what it removed so the
// caller can broadcast it over SSE the same way removeSelection does.
export function clearSelections(): TimetableEntry[] {
  const existing = listSelections();
  db.delete(selections).run();
  return existing;
}

export interface AutoSelectResult {
  added: TimetableEntry[];
  conflicts: string[];
}

// One-click enrol: rebuild the timetable from scratch so the result is
// reproducible rather than layered on whatever was already selected. Every
// non-Lab session is added unconditionally (Lectures/Tutorials/Studios never
// clash, so there's nothing to choose between); for Labs, only one is
// required per course, so options are tried in day/time order and the first
// one that doesn't clash with a Lab already placed for an earlier course
// wins. This is greedy, not an exhaustive search over every combination —
// good enough for a catalogue this size, where it happens to resolve
// cleanly, but a pathological catalogue could have a workable assignment
// that a different pick order would have found and this one misses. A
// course whose every Lab option clashes lands in `conflicts`: its Lecture
// (and any other non-Lab sessions) are still on the timetable, just without
// a Lab, and the caller is expected to tell the student to swap that course
// out rather than to keep searching for a Lab that isn't actually free.
export function autoSelectAll(): AutoSelectResult {
  clearSelections();

  const byCourse = new Map<string, Offering[]>();
  for (const offering of listOfferings()) {
    const list = byCourse.get(offering.courseCode) ?? [];
    list.push(offering);
    byCourse.set(offering.courseCode, list);
  }

  const added: TimetableEntry[] = [];
  const conflicts: string[] = [];

  for (const [courseCode, sessions] of byCourse) {
    for (const offering of sessions) {
      if (offering.sessionType === "Lab") continue;
      const result = addSelection(offering.id);
      if (result.ok) added.push(result.entry);
    }

    const labs = sessions.filter((offering) => offering.sessionType === "Lab");
    if (labs.length === 0) continue;

    const placed = labs.some((offering) => {
      const result = addSelection(offering.id);
      if (result.ok) added.push(result.entry);
      return result.ok;
    });
    if (!placed) conflicts.push(courseCode);
  }

  return { added, conflicts };
}

seedOfferingsIfEmpty();
