import type { APIRoute } from "astro";
import { clearSelections } from "../../lib/db";
import { bus } from "../../lib/events";

// The "cancel" half of one-click enrol, and a plain clear-timetable button
// on its own merits. Mirrors timetable-remove.ts's shape, just for every
// selection at once.
export const POST: APIRoute = async ({ redirect }) => {
  const removed = clearSelections();
  for (const entry of removed) bus.emit("selection", entry);
  return redirect("/?cleared=1", 303);
};
