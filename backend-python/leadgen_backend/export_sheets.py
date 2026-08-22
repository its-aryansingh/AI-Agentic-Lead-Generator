import os
import urllib.parse
import httpx
from leadgen_backend.export_csv import CSV_HEADER_ROW, row_to_csv_values

async def export_to_sheet(refresh_token: str | None, title: str, rows: list[dict]) -> dict:
    client_id = os.getenv("GOOGLE_CLIENT_ID")
    client_secret = os.getenv("GOOGLE_CLIENT_SECRET")
    
    if not client_id or not refresh_token:
        encoded_title = urllib.parse.quote(title)
        return {
            "url": f"https://docs.google.com/spreadsheets/d/mock-{encoded_title}/edit",
            "mock": True
        }
        
    async with httpx.AsyncClient() as client:
        # 1. Exchange refresh token for access token
        token_res = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token"
            }
        )
        token_res.raise_for_status()
        access_token = token_res.json()["access_token"]
        headers = {"Authorization": f"Bearer {access_token}"}
        
        # 2. Create Spreadsheet
        create_res = await client.post(
            "https://sheets.googleapis.com/v4/spreadsheets",
            headers=headers,
            json={
                "properties": {"title": title},
                "sheets": [{"properties": {"title": "Prospects"}}]
            }
        )
        create_res.raise_for_status()
        create_data = create_res.json()
        spreadsheet_id = create_data["spreadsheetId"]
        url = create_data["spreadsheetUrl"]
        sheet_id = create_data.get("sheets", [{}])[0].get("properties", {}).get("sheetId", 0)
        
        # 3. Insert Data
        values = [CSV_HEADER_ROW] + [row_to_csv_values(r) for r in rows]
        await client.put(
            f"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}/values/Prospects!A1",
            headers=headers,
            params={"valueInputOption": "RAW"},
            json={"values": values}
        )
        
        # 4. Bold Header
        await client.post(
            f"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}:batchUpdate",
            headers=headers,
            json={
                "requests": [{
                    "repeatCell": {
                        "range": {
                            "sheetId": sheet_id,
                            "startRowIndex": 0,
                            "endRowIndex": 1
                        },
                        "cell": {"userEnteredFormat": {"textFormat": {"bold": True}}},
                        "fields": "userEnteredFormat.textFormat.bold"
                    }
                }]
            }
        )
        
        return {"url": url, "mock": False}
