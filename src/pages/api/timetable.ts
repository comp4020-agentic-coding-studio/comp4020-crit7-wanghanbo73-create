import type { APIRoute } from "astro";
import { addSelection } from "../../lib/db";
import { bus } from "../../lib/events";

// The write half of the app: a plain HTML form POSTs an offeringId here.
// A clash is rejected without touching the database and the student is
// redirected back with ?clash=<id> so the page can explain why with no
// client-side JavaScript at all. A clean add is broadcast to every open SSE
// connection, same shape as the starter's guestbook.
export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const offeringId = Number(form.get("offeringId"));
  if (!Number.isInteger(offeringId)) return redirect("/", 303);

  const result = addSelection(offeringId);
  if (!result.ok) {
    if (result.reason === "clash") {
      return redirect(`/?clash=${offeringId}&with=${result.clash.id}`, 303);
    }
    return redirect("/", 303);
  }

  bus.emit("selection", result.entry);
  return redirect("/", 303);
};
