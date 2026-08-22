import csv
import io
from datetime import datetime, UTC

CSV_HEADER_ROW = [
    "Name",
    "Title",
    "Company",
    "Email",
    "Email confidence",
    "Research summary",
    "Email subject",
    "Email body",
    "Talking point 1",
    "Talking point 2",
    "Talking point 3",
    "Source URL",
    "Generated at",
]

def row_to_csv_values(p: dict) -> list[str]:
    t = p.get("talking_points") or []
    return [
        str(p.get("input_name") or ""),
        "",  # Title is empty in TS
        str(p.get("input_company") or ""),
        str(p.get("email") or ""),
        str(p.get("email_confidence") or ""),
        str(p.get("research_summary") or ""),
        str(p.get("email_subject") or ""),
        str(p.get("email_body") or ""),
        str(t[0]) if len(t) > 0 else "",
        str(t[1]) if len(t) > 1 else "",
        str(t[2]) if len(t) > 2 else "",
        str(p.get("input_linkedin_url") or ""),
        datetime.now(UTC).isoformat()
    ]

def rows_to_csv(rows: list[dict]) -> str:
    output = io.StringIO()
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow(CSV_HEADER_ROW)
    for row in rows:
        writer.writerow(row_to_csv_values(row))
    return output.getvalue()
