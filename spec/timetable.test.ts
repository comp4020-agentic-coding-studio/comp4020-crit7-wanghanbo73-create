import { describe, expect, inject, it } from "vitest";

// Drives the running app over HTTP to prove the two contracts crit 7's
// spec names: the core flow (adding a session) persists across a reload,
// and a clash between any two sessions that overlap in time on the same day
// is caught — regardless of session type or course. The seed catalogue is
// deterministic (see seedOfferingsIfEmpty in src/lib/db.ts): offering 13
// (COMP1100 Lecture, Mon 11:00-12:00) and offering 9 (COMP2100 Lab, Mon
// 11:30-12:30) overlap despite being different session types from different
// courses, while offering 2 (COMP4020 Lab, Mon 14:00-15:30) and offering 7
// (COMP2100 Lab, Mon 14:00-15:30) overlap and are both Labs.
// Tests run in order within this file and share one server.
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

const remove = (selectionId: number) =>
  fetch(new URL("/api/timetable-remove", baseUrl), {
    method: "POST",
    headers: { origin: baseUrl },
    body: new URLSearchParams({ selectionId: String(selectionId) }),
    redirect: "manual",
  });

const autoselect = () =>
  fetch(new URL("/api/timetable-autoselect", baseUrl), {
    method: "POST",
    headers: { origin: baseUrl },
    redirect: "manual",
  });

const clearAll = () =>
  fetch(new URL("/api/timetable-clear", baseUrl), {
    method: "POST",
    headers: { origin: baseUrl },
    redirect: "manual",
  });

describe("timetable", () => {
  it("accepts a session and it persists across a reload", async () => {
    // offering 13: COMP1100 Lecture, Mon 11:00-12:00 — clashes with nothing yet
    const res = await post(13);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/?added=13");

    const page = await fetch(baseUrl);
    const html = await page.text();
    expect(html).toContain("COMP1100");
    expect(html).toContain("Mon");
  });

  it("rejects an overlapping session regardless of session type, but allows non-overlapping ones", async () => {
    // offering 9 (COMP2100 Lab, Mon 11:30-12:30) overlaps offering 13
    // (COMP1100 Lecture, Mon 11:00-12:00), already on the timetable from the
    // previous test — a Lecture and a different course's Lab, proving the
    // clash rule is no longer Lab-only.
    const crossType = await post(9);
    expect(crossType.status).toBe(303);
    expect(crossType.headers.get("location")).toBe("/?clash=9&with=13");

    // offering 2 (COMP4020 Lab, Mon 14:00-15:30) — a clean add
    const lab1 = await post(2);
    expect(lab1.status).toBe(303);
    expect(lab1.headers.get("location")).toBe("/?added=2");

    // offering 7 (COMP2100 Lab, Mon 14:00-15:30) overlaps offering 2 exactly
    // and is also a Lab — the classic clash the app must still catch.
    const clashing = await post(7);
    expect(clashing.status).toBe(303);
    expect(clashing.headers.get("location")).toBe("/?clash=7&with=2");

    const page = await fetch(baseUrl);
    const html = await page.text();
    const timetableSection = html.match(/<div id="timetable"[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(timetableSection).toContain("COMP1100 Lecture");
    expect(timetableSection).toContain("COMP4020 Lab");
    // both the cross-type and the lab-vs-lab clash were rejected
    expect(timetableSection).not.toContain("COMP2100 Lab");
  });

  it("broadcasts a new selection over the SSE stream", async () => {
    // subscribe first, then post, then read until the event arrives
    const stream = await fetch(new URL("/api/events", baseUrl));
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    const reader = stream.body?.getReader();
    if (!reader) throw new Error("no response body");

    // offering 8: COMP2100 Lab, Thu 13:00-15:00 — clashes with nothing added so far
    await post(8);

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

  it("removes a session from the timetable", async () => {
    // offering 10: COMP3600 Lecture, Wed 13:00-14:00 — clashes with nothing added so far
    const added = await post(10);
    expect(added.status).toBe(303);
    expect(added.headers.get("location")).toBe("/?added=10");

    const beforeHtml = await (await fetch(baseUrl)).text();
    const slots = beforeHtml.match(/<div class="slot[^"]*"[\s\S]*?<\/div>/g) ?? [];
    const slot = slots.find((s) => s.includes("COMP3600"));
    expect(slot).toBeDefined();
    const selectionId = Number(slot?.match(/data-selection-id="(\d+)"/)?.[1]);
    expect(Number.isInteger(selectionId)).toBe(true);

    const removed = await remove(selectionId);
    expect(removed.status).toBe(303);
    expect(removed.headers.get("location")).toBe("/?removed=10");

    const afterHtml = await (await fetch(baseUrl)).text();
    const timetableSection = afterHtml.match(/<div id="timetable"[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(timetableSection).not.toContain("COMP3600");
  });

  it("replaces a course's existing Lab when a different Lab option for the same course is added", async () => {
    // offering 2 (COMP4020 Lab, Mon 14:00-15:30) is still on the timetable
    // from the earlier clash test above and hasn't been removed since.
    const before = await (await fetch(baseUrl)).text();
    const beforeSection = before.match(/<div id="timetable"[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(beforeSection).toContain("14:00");
    const labSlotsBefore = (beforeSection.match(/<div class="slot type-lab"/g) ?? []).length;

    // offering 3: COMP4020 Lab, Wed 09:00-10:30 — a different time option for
    // the same course, doesn't overlap offering 2 at all, so a plain overlap
    // rule would have let both sit on the timetable together. A course only
    // needs one Lab, so this should swap offering 2 out instead of adding a
    // second Lab slot.
    const res = await post(3);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/?added=3");

    const after = await (await fetch(baseUrl)).text();
    const afterSection = after.match(/<div id="timetable"[\s\S]*?<\/section>/)?.[0] ?? "";
    const labSlotsAfter = (afterSection.match(/<div class="slot type-lab"/g) ?? []).length;
    expect(labSlotsAfter).toBe(labSlotsBefore);
    expect(afterSection).toContain("COMP4020 Lab");
    expect(afterSection).toContain("09:00–10:30");
    expect(afterSection).not.toContain("14:00–15:30");
  });

  it("one-click enrol fills every course's compulsory sessions and a non-clashing Lab, and clear empties the timetable", async () => {
    // The seed catalogue's clashes (2x7, 3x11, 9x13) are all resolvable by
    // picking each course's Lab options in a different order, so a correct
    // greedy pass hits zero conflicts here — see autoSelectAll's doc comment
    // in src/lib/db.ts for why that's not a general guarantee.
    const res = await autoselect();
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/?autoselected=1");

    const html = await (await fetch(baseUrl)).text();
    const timetableSection = html.match(/<div id="timetable"[\s\S]*?<\/section>/)?.[0] ?? "";
    // one Lecture (or, for COMP4020, Lecture + Studio) and exactly one Lab
    // per course that has one
    expect(timetableSection).toContain("COMP4020 Lecture");
    expect(timetableSection).toContain("COMP4020 Lab");
    expect(timetableSection).toContain("COMP4020 Studio");
    expect(timetableSection).toContain("COMP2100 Lecture");
    expect(timetableSection).toContain("COMP2100 Lab");
    expect(timetableSection).toContain("COMP3600 Lecture");
    expect(timetableSection).toContain("COMP3600 Lab");
    expect(timetableSection).toContain("COMP1100 Lecture");
    const slots = timetableSection.match(/<div class="slot[^"]*"/g) ?? [];
    expect(slots.length).toBe(8); // 3 (COMP4020) + 2 + 2 + 1 (COMP1100 has no Lab)

    const cleared = await clearAll();
    expect(cleared.status).toBe(303);
    expect(cleared.headers.get("location")).toBe("/?cleared=1");

    const afterHtml = await (await fetch(baseUrl)).text();
    expect(afterHtml).toContain("Nothing added yet.");
    const afterTimetableSection =
      afterHtml.match(/<div id="timetable"[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(afterTimetableSection.match(/<div class="slot[^"]*"/g) ?? []).toHaveLength(0);
  });
});
