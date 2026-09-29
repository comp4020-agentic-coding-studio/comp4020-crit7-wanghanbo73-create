# Crit 7 reflection

**Breakthrough:** the moment that moved things forward wasn't writing the
general clash rule itself — that was a small diff. It was insisting Claude
check what the *existing* code actually did before touching it, instead of
trusting my own memory of "only Labs clash." That check surfaced that a
Lecture overlapping another course's Lab was silently accepted, which is
exactly the bug a real student would hit and complain about. Planning the
change before writing it also paid off directly: the plan named the seed
data and the one-click-enrol algorithm as things that would need rework
alongside the rule itself, which is what made the later ordering bug
(caught by hand-tracing the greedy algorithm against the new seed times)
something I was looking for rather than something I stumbled into.

**What this changed about who I want to be as a developer:** I want to keep
treating "have the agent read the current behaviour and state it back to me
before changing it" as a default step, not something reserved for large
changes. It's cheap, and twice this week it caught something my own mental
model of the code had gotten wrong. I also want to keep separating "confirm
the rule" from "implement the rule" — asking the clarifying question about
scope (any overlap vs. Lab-only-but-wider) before any code moved meant the
whole rest of the session was building toward something I'd actually agreed
to, rather than redoing it after the fact.
