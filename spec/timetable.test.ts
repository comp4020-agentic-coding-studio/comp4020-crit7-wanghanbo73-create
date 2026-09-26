import { describe, expect, inject, it } from "vitest";

// Drives the running app over HTTP to prove the two contracts crit 7's
// spec names: the core flow (adding a session) persists across a reload,
// and a clash is caught rather than silently allowed. The seed catalogue is
// deterministic (see seedOfferingsIfEmpty in src/lib/db.ts) — offering 1
// (COMP4020 Lecture, Mon 10:00-11:00) and offering 2 (COMP4020 Tutorial,
// Mon 10:30-11:30) deliberately overlap, so this suite is written against
// that fixed pair. Tests run in order within this file and share one server.
const baseUrl = inject("baseUrl");

// Astro checks form POSTs carry a same-origin Origin header (CSRF
// protection); browsers send it automatically, a bare fetch doesn't.
const post = (offeringId: number) =>
  fetch(new URL("/api/timetable", baseUrl), {
    method: "POST",
    headers: { origin: baseUrl },
    body: new URLSearchParams({ offeringId: String(offeringId) }),
    redirect: "manual",
  });

describe("timetable", () => {
  it("accepts a session and it persists across a reload", async () => {
    // offering 3: COMP2100 Lecture, Tue 09:00-10:00 — clashes with nothing
    const res = await post(3);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");

    const page = await fetch(baseUrl);
    const html = await page.text();
    expect(html).toContain("COMP2100");
    expect(html).toContain("Tue");
  });

  it("rejects a session that clashes with one already on the timetable", async () => {
    // offering 1 first (clean add), then offering 2 which overlaps it
    const first = await post(1);
    expect(first.status).toBe(303);
    expect(first.headers.get("location")).toBe("/");

    const clashing = await post(2);
    expect(clashing.status).toBe(303);
    expect(clashing.headers.get("location")).toBe("/?clash=2&with=1");

    const page = await fetch(baseUrl);
    const html = await page.text();
    const timetableSection = html.match(/<ul id="timetable">[\s\S]*?<\/section>/)?.[0] ?? "";
    // the clashing tutorial was never added to the timetable — it's still
    // offered (in the "available sessions" list further down the page,
    // outside this section), just not on it
    expect(timetableSection).toContain("COMP4020 Lecture");
    expect(timetableSection).not.toContain("COMP4020 Tutorial");
  });

  it("broadcasts a new selection over the SSE stream", async () => {
    // subscribe first, then post, then read until the event arrives
    const stream = await fetch(new URL("/api/events", baseUrl));
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    const reader = stream.body?.getReader();
    if (!reader) throw new Error("no response body");

    // offering 4: COMP2100 Lab, Tue 14:00-16:00 — clashes with nothing added so far
    await post(4);

    const decoder = new TextDecoder();
    let received = "";
    while (!received.includes("COMP2100")) {
      const { value, done } = await reader.read();
      if (done) throw new Error("stream ended before the event arrived");
      received += decoder.decode(value, { stream: true });
    }
    await reader.cancel();
    expect(received).toContain("data: ");
  }, 10_000);
});
