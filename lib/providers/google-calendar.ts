import { createHash } from "node:crypto";

import { google } from "googleapis";

const READ_SCOPE = "https://www.googleapis.com/auth/calendar.events.freebusy";
const WRITE_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const EMAIL_SCOPE = "https://www.googleapis.com/auth/userinfo.email";

function configured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function isGoogleCalendarAuthError(error: unknown) {
  const status = Number(
    (error as { code?: unknown; response?: { status?: unknown } }).response
      ?.status ?? (error as { code?: unknown }).code,
  );
  return status === 401 || status === 403;
}

function redirectUri() {
  return (
    process.env.GOOGLE_CALENDAR_REDIRECT_URI ??
    `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/calendar/callback`
  );
}

function oauthClient(refreshToken?: string) {
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri(),
  );
  if (refreshToken) client.setCredentials({ refresh_token: refreshToken });
  return client;
}

export function googleCalendarConsentUrl(state: string) {
  if (!configured()) return null;
  return oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: true,
    scope: [READ_SCOPE, WRITE_SCOPE, EMAIL_SCOPE],
    state,
  });
}

export async function exchangeGoogleCalendarCode(code: string) {
  if (!configured()) throw new Error("GOOGLE_CALENDAR_NOT_CONFIGURED");
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) throw new Error("CALENDAR_REFRESH_TOKEN_MISSING");
  client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const profile = await oauth2.userinfo.get();
  if (!profile.data.email) throw new Error("CALENDAR_EMAIL_MISSING");
  return { email: profile.data.email, refreshToken: tokens.refresh_token };
}

export async function revokeGoogleCalendarCredential(refreshToken: string) {
  const response = await fetch(
    `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`,
    { method: "POST", signal: AbortSignal.timeout(10_000) },
  );
  if (!response.ok && response.status !== 400) {
    throw new Error("CALENDAR_REVOKE_FAILED");
  }
}

export type BusyPeriod = { start: string; end: string };

export async function getGoogleCalendarBusyPeriods(options: {
  refreshToken: string;
  calendarId: string;
  timeMin: string;
  timeMax: string;
  timezone: string;
}): Promise<BusyPeriod[]> {
  if (!configured()) throw new Error("GOOGLE_CALENDAR_NOT_CONFIGURED");
  const calendar = google.calendar({
    version: "v3",
    auth: oauthClient(options.refreshToken),
  });
  const response = await calendar.freebusy.query({
    requestBody: {
      timeMin: options.timeMin,
      timeMax: options.timeMax,
      timeZone: options.timezone,
      items: [{ id: options.calendarId }],
    },
  });
  const calendars = response.data.calendars ?? {};
  const entry =
    calendars[options.calendarId] ?? Object.values(calendars)[0];
  if (entry?.errors?.length) throw new Error("CALENDAR_FREEBUSY_FAILED");
  return (entry?.busy ?? []).flatMap((period) =>
    period.start && period.end
      ? [{ start: period.start, end: period.end }]
      : [],
  );
}

export async function verifyGoogleCalendar(options: {
  refreshToken: string;
  calendarId: string;
  timezone: string;
}) {
  const now = new Date();
  await getGoogleCalendarBusyPeriods({
    ...options,
    timeMin: now.toISOString(),
    timeMax: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
  });
}

export async function createGoogleCalendarMeeting(options: {
  refreshToken: string;
  calendarId: string;
  idempotencyKey: string;
  title: string;
  description: string;
  start: string;
  end: string;
  timezone: string;
  attendeeEmail: string;
}) {
  if (!configured()) throw new Error("GOOGLE_CALENDAR_NOT_CONFIGURED");
  const calendar = google.calendar({
    version: "v3",
    auth: oauthClient(options.refreshToken),
  });
  const eventId = createHash("sha256")
    .update(options.idempotencyKey)
    .digest("hex")
    .slice(0, 32);
  try {
    const response = await calendar.events.insert({
      calendarId: options.calendarId,
      conferenceDataVersion: 1,
      sendUpdates: "all",
      requestBody: {
        id: eventId,
        summary: options.title,
        description: options.description,
        start: { dateTime: options.start, timeZone: options.timezone },
        end: { dateTime: options.end, timeZone: options.timezone },
        attendees: [{ email: options.attendeeEmail }],
        conferenceData: {
          createRequest: {
            requestId: eventId,
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
      },
    });
    return {
      eventId: String(response.data.id ?? eventId),
      htmlLink: response.data.htmlLink ?? null,
      meetingLink: response.data.hangoutLink ?? null,
      replayed: false,
    };
  } catch (error) {
    const status = Number(
      (error as { code?: unknown; response?: { status?: unknown } }).response
        ?.status ?? (error as { code?: unknown }).code,
    );
    if (status !== 409) throw error;
    const existing = await calendar.events.get({
      calendarId: options.calendarId,
      eventId,
    });
    return {
      eventId,
      htmlLink: existing.data.htmlLink ?? null,
      meetingLink: existing.data.hangoutLink ?? null,
      replayed: true,
    };
  }
}
