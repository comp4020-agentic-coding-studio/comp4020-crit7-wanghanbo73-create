import type { APIRoute } from "astro";
import { removeSelection } from "../../lib/db";
import { bus } from "../../lib/events";

// Mirrors api/timetable.ts's shape: a plain HTML form POST, redirect back
// with a query param so the page can render a toast with no client JS.
export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const selectionId = Number(form.get("selectionId"));
  if (!Number.isInteger(selectionId)) return redirect("/", 303);

  const removed = removeSelection(selectionId);
  if (!removed) return redirect("/", 303);

  bus.emit("selection", removed);
  return redirect(`/?removed=${removed.offering.id}`, 303);
};
