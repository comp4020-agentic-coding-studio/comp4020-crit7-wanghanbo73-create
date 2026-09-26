# Timetable clash checker

The ANU timetabling system I actually deal with lets you add two sessions that
overlap in time and only tells you once you go looking for the clash
yourself. This is the version I wish existed: pick sessions from a catalogue
of course offerings, and the moment one overlaps something already on your
timetable, it's rejected on the spot instead of silently double-booking you.

## What good looks like here

Good means: adding a session persists (SQLite, survives a reload), and the
overlap check is the one rule the app can't be trusted without — same day,
overlapping time range, rejected, with the page explaining what it clashed
with. That rule is enforced by `spec/timetable.test.ts`; the generic
navigation/accessibility floor is enforced by `spec/invariants.test.ts`.

Deliberately out of scope this week: no login (one shared timetable), no
removing a session once added, and no admin UI for the offerings catalogue —
it's fixed seed data standing in for the real timetable feed. These are
judgement calls about where a week's worth of effort goes, not oversights.

Images go in `public/` and are linked relatively — `![alt](public/before.png)`
— which renders on GitHub and at `/readme/` alike.
