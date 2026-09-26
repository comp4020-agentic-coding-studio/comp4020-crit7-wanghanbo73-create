import { sql } from "drizzle-orm";
import { int, sqliteTable, text } from "drizzle-orm/sqlite-core";

// The schema is the ground truth for the database. To change it: edit here,
// run `pnpm db:generate` to turn the diff into a migration under drizzle/,
// and commit both — the migration applies automatically when the server
// boots (see src/lib/db.ts), locally and deployed. Never edit the database
// by hand: state on the deployed volume outlives every deploy, and the
// migration trail is what keeps old state and new code compatible.

// The catalogue of course sessions on offer — the read-only slice of the
// real ANU timetable. Seeded at boot (see src/lib/db.ts); nothing writes to
// this table at runtime.
export const offerings = sqliteTable("offerings", {
  id: int().primaryKey({ autoIncrement: true }),
  courseCode: text("course_code").notNull(),
  sessionType: text("session_type").notNull(),
  day: text().notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  location: text().notNull(),
});

// "My timetable" — the sessions a student has added. This is the table the
// core flow writes to, and what must survive a reload.
export const selections = sqliteTable("selections", {
  id: int().primaryKey({ autoIncrement: true }),
  offeringId: int("offering_id")
    .notNull()
    .references(() => offerings.id),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export type Offering = typeof offerings.$inferSelect;
export type Selection = typeof selections.$inferSelect;
