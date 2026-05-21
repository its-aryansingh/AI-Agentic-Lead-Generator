import { Inngest } from "inngest"

export const inngest = new Inngest({
  id: "leadgenai",
  // Falls back to a no-op logger when INNGEST_EVENT_KEY is not set, so
  // local dev without an Inngest account still works (sync path is used).
})
