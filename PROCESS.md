# Process overview

## What I built

A timetable clash checker: pick sessions from a fixed catalogue of course
offerings, and the app rejects an add on the spot if it overlaps something
already on your personal timetable. See `README.md` for what the app is and
what good means here.

## How I got here

The offerings/selections data model, the API routes, and the weekly-grid UI
came together over several commits —
[`09f0df7...4dc46bf`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-wanghanbo73-create/compare/09f0df7...4dc46bf) —
ending with the clash rule scoped to Lab sessions only: two overlapping
Lectures were allowed to coexist, on the reasoning that a Lecture is
broadcast to everyone enrolled rather than competing for a room.

Sitting with that rule, it didn't hold up: a student who's actually double
booked doesn't care whether the two things they can't both attend are Labs.
I asked Claude Code to check whether that scenario was actually caught:

> 我想给每门课程多添加几种lab可选……先不修改代码，你理解我的意思了吗

and then, once we'd confirmed the intended behaviour together (add more Lab
options per course; picking a different Lab option for the same course
swaps it rather than stacking):

> 是我想要的改动，改进这个后再补充一些lab就像上文说的

Claude read `findClash` in `src/lib/db.ts`, confirmed the Lab-only
restriction was real (a Lecture clashing with another course's Lab at the
same hour was silently accepted), and proposed widening the rule to any
overlapping session type before touching code. I approved that plan, and it
landed in
[`4f71c7a`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit7-wanghanbo73-create/commit/4f71c7a):
`findClash` now flags any two overlapping sessions regardless of type,
`autoSelectAll`'s greedy one-click-enrol had to account for non-Lab clashes
too, and the seed catalogue grew to two or three Lab time options per course
so the "pick a different Lab, the old one swaps out" behaviour is easy to
exercise.

I knew the result was right because `pnpm check` (typecheck plus the full
`spec/timetable.test.ts` suite against the built server) catches this class
of regression directly, and because before trusting the "0 conflicts"
one-click-enrol result I had Claude hand-trace the greedy algorithm's
schedule against the new seed data — that trace caught an ordering bug (the
greedy tries Lab options in day/time order, not catalogue-insertion order)
that a first pass at the new seed data would have shipped broken, and it was
fixed and re-verified against the test suite before I asked for the deploy.
