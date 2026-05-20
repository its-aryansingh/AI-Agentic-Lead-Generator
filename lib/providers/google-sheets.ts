/**
 * Google Sheets export.
 *
 * Creates a fresh spreadsheet in the user's Drive (scope: drive.file)
 * using their OAuth refresh token (stored at sign-in). Returns the URL.
 *
 * Falls back to producing a deterministic mock URL when GOOGLE_CLIENT_ID
 * isn't configured so the chat flow still completes end-to-end in dev.
 */

import { google } from "googleapis"

import { hasKey } from "@/lib/utils"
import {
  CSV_HEADER_ROW as HEADER_ROW,
  rowToCsvValues,
  rowsToCsv as csvRowsToCsv,
  type ProspectRow,
} from "@/lib/csv"

// Re-export from lib/csv so existing call sites continue to work.
export type { ProspectRow }
export const rowsToCsv = csvRowsToCsv

export async function exportToSheet(opts: {
  refreshToken: string | null
  title: string
  rows: ProspectRow[]
}): Promise<{ url: string; mock: boolean }> {
  if (!hasKey("google") || !opts.refreshToken) {
    // Mock fallback — return a URL that a UI can render without
    // actually creating anything on the user's Drive.
    return {
      url: `https://docs.google.com/spreadsheets/d/mock-${encodeURIComponent(opts.title)}/edit`,
      mock: true,
    }
  }

  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  )
  oauth2.setCredentials({ refresh_token: opts.refreshToken })

  const sheets = google.sheets({ version: "v4", auth: oauth2 })

  const create = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: opts.title },
      sheets: [{ properties: { title: "Prospects" } }],
    },
  })
  const spreadsheetId = create.data.spreadsheetId!
  const url = create.data.spreadsheetUrl!

  const values = [HEADER_ROW, ...opts.rows.map(rowToCsvValues)]
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "Prospects!A1",
    valueInputOption: "RAW",
    requestBody: { values },
  })

  // Bold the header row.
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: {
              sheetId: create.data.sheets?.[0].properties?.sheetId ?? 0,
              startRowIndex: 0,
              endRowIndex: 1,
            },
            cell: { userEnteredFormat: { textFormat: { bold: true } } },
            fields: "userEnteredFormat.textFormat.bold",
          },
        },
      ],
    },
  })

  return { url, mock: false }
}

// rowToCsvValues and rowsToCsv now live in lib/csv.ts and are re-exported
// at the top of this file. They were moved so unit tests can import them
// without pulling googleapis or the @/* path alias.
