// Migration paths rewritten during the SalesEngAIMVP port. This repo
// consolidates those Supabase migrations into db/migrations/
// 0003_salesengai.sql and 0004_salesengai_phase8.sql, which is the
// SQL that actually runs on Railway — so the assertions now guard
// the applied artifact rather than a file nothing executes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  findAvailableMeetingSlots,
  meetingSlotAllowed,
  parseSlotId,
} from "@/lib/voice/calendar-policy";

import { assertNoSupabaseRls, assertReadOnlyForUsers, assertTenantScoped } from "./helpers/tenancy.ts"

const policy = {
  timezone: "Asia/Kolkata",
  startHour: 9,
  endHour: 18,
  weekdays: [1, 2, 3, 4, 5],
  durationMinutes: 30,
  incrementMinutes: 30,
  bufferMinutes: 15,
};

test("calendar slots honor business hours, busy periods, buffers, and opaque IDs", () => {
  const now = new Date("2026-09-07T03:00:00.000Z"); // Monday 08:30 IST
  const slots = findAvailableMeetingSlots({
    policy,
    now,
    busy: [{ start: "2026-09-07T04:30:00.000Z", end: "2026-09-07T05:00:00.000Z" }],
    limit: 3,
  });
  assert.equal(slots.length, 3);
  assert.deepEqual(parseSlotId(slots[0].id), {
    start: slots[0].start,
    end: slots[0].end,
  });
  assert.equal(slots.some((slot) => slot.start === "2026-09-07T04:00:00.000Z"), false);
});

test("confirmed slot is rechecked immediately before insertion", () => {
  const now = new Date("2026-09-07T03:00:00.000Z");
  const start = new Date("2026-09-07T05:30:00.000Z");
  const end = new Date("2026-09-07T06:00:00.000Z");
  assert.equal(meetingSlotAllowed({ policy, busy: [], start, end, now }), true);
  assert.equal(
    meetingSlotAllowed({
      policy,
      busy: [{ start: start.toISOString(), end: end.toISOString() }],
      start,
      end,
      now,
    }),
    false,
  );
});

test("calendar connection is tenant-scoped and stores only encrypted credentials", () => {
  const migration = readFileSync(
    "db/migrations/0004_salesengai_phase8.sql",
    "utf8",
  );
  assert.match(migration, /calendar_connections/i);
  assertTenantScoped("calendar_connections");
  assert.match(migration, /encrypted_refresh_token text not null/i);
  assert.doesNotMatch(migration, /\brefresh_token text/i);
});

test("calendar connect and disconnect automatically synchronize managed Bolna tools", () => {
  const callback = readFileSync("app/api/calendar/callback/route.ts", "utf8");
  const settings = readFileSync(
    "app/app/settings/voice-calling/page.tsx",
    "utf8",
  );
  const sync = readFileSync("lib/voice/calendar-agent-sync.ts", "utf8");
  assert.match(callback, /syncManagedAgentCalendarTools\(user\.id, true\)/);
  assert.match(settings, /syncManagedAgentCalendarTools\(user\.id, false\)/);
  assert.match(sync, /calendarBookingEnabled/);
  assert.match(sync, /updateBolnaQualificationAgent/);
});
