import type { APIRoute } from "astro";
import { autoSelectAll } from "../../lib/db";
import { bus } from "../../lib/events";

// One-click enrol: rebuilds the whole timetable in one POST (see
// autoSelectAll's doc comment for the greedy Lab-picking rule). Broadcasts
// every resulting selection so other open tabs pick the batch up as a single
// reload, same as any other change. Courses whose Lab options all clash come
// back in `conflicts` so the page can point at exactly those, instead of a
// generic "something didn't fit".
export const POST: APIRoute = async ({ redirect }) => {
  const { added, conflicts } = autoSelectAll();
  for (const entry of added) bus.emit("selection", entry);

  const query =
    conflicts.length > 0
      ? `?autoselected=1&conflicts=${encodeURIComponent(conflicts.join(","))}`
      : "?autoselected=1";
  return redirect(`/${query}`, 303);
};
