#!/usr/bin/env python3
"""Extract contractor relationship cells from the SV PROJ SHETS workbook."""

from __future__ import annotations

import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from zipfile import ZipFile

MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS = {"m": MAIN_NS, "r": REL_NS}

SHEET_CONFIG = {
    "1. LCP & DIR - PAS CIP+DPW": {
        "role": "columns",
        "project_number_columns": ["C"],
        "project_name_column": "E",
        "primary_column": "G",
        "subcontractor_column": "H",
    },
    "2. LCP & DIR - DESIGN": {
        "role": "columns",
        "project_number_columns": ["C"],
        "project_name_column": "F",
        "primary_column": "G",
        "subcontractor_column": "H",
    },
    "3. LCP & DIR - ON CALL NON PAS": {
        "role": "columns",
        "project_number_columns": ["C", "D"],
        "project_name_column": "G",
        "primary_column": "I",
        "subcontractor_column": "J",
    },
    "Active Federal Projects": {
        "role": "unclassified",
        "project_number_columns": ["B", "C"],
        "project_name_column": "A",
        "contractor_column": "D",
    },
}

NOTE_PATTERNS = [
    r"^\d{1,2}/\d{1,2}/\d{2,4}:?\s",
    r"^completed\s+subs?\b",
    r"^next\s+steps?\b",
    r"^sent\s+.*email\b",
    r"^emailed\b",
    r"^email\b",
    r"^no\s+longer\b",
    r"^no\s+surveyor\s+work\b",
    r"^pwcr\s*#",
    r"^correct\s+pwcr\s*#",
    r"^replaced?\b",
    r"^contractor\s+will\s+be\s+substituted\b",
    r"^amount\s+increased\b",
    r"^station\s+\d+\s+work\s+dates\b",
    r"^last\s+invoices?\b",
    r"^inv(?:oice)?\s+\d",
    r"^al\s+\d{1,2}/\d{1,2}/\d{2,4}\b",
    r"^exempt\s+from\s+prevailing\s+wage\b",
    r"^\*\*",
]


def cell_column(reference: str) -> str:
    return "".join(character for character in reference if character.isalpha())


def read_cell_value(cell: ET.Element, shared_strings: list[str]) -> str:
    value = cell.find(f"{{{MAIN_NS}}}v")
    text = "" if value is None else value.text or ""
    if cell.attrib.get("t") == "s" and text:
        text = shared_strings[int(text)]
    elif cell.attrib.get("t") == "inlineStr":
        text = "".join(node.text or "" for node in cell.findall(f".//{{{MAIN_NS}}}t"))
    return " ".join(text.split()).strip()


def is_note(value: str) -> bool:
    lowered = value.casefold()
    return any(re.search(pattern, lowered) for pattern in NOTE_PATTERNS)


def clean_relationship_value(value: str) -> str:
    pwcr = re.search(r"\bPWCR\s*#", value, re.IGNORECASE)
    if pwcr:
        value = value[:pwcr.start()].strip()
    return " ".join(value.split()).strip()


def extract(workbook_path: Path) -> list[dict[str, object]]:
    relationships: list[dict[str, object]] = []
    with ZipFile(workbook_path) as archive:
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        workbook_rels = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        targets = {node.attrib["Id"]: node.attrib["Target"] for node in workbook_rels}
        shared_strings: list[str] = []
        if "xl/sharedStrings.xml" in archive.namelist():
            shared_root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            shared_strings = [
                "".join(node.text or "" for node in item.findall(".//m:t", NS))
                for item in shared_root.findall("m:si", NS)
            ]

        sheets = {sheet.attrib["name"]: sheet for sheet in workbook.find("m:sheets", NS)}
        for sheet_name, config in SHEET_CONFIG.items():
            sheet = sheets.get(sheet_name)
            if sheet is None:
                continue
            target = targets[sheet.attrib[f"{{{REL_NS}}}id"]].lstrip("/")
            if not target.startswith("xl/"):
                target = f"xl/{target}"

            project_context: dict[str, object] = {
                "projectName": "",
                "projectNumbers": [],
                "projectAnchorRow": None,
            }
            with archive.open(target) as sheet_file:
                for _, row in ET.iterparse(sheet_file, events=("end",)):
                    if row.tag != f"{{{MAIN_NS}}}row":
                        continue
                    values: dict[str, str] = {}
                    columns = set(config["project_number_columns"])
                    columns.add(config["project_name_column"])
                    if config["role"] == "columns":
                        columns.update([config["primary_column"], config["subcontractor_column"]])
                    else:
                        columns.add(config["contractor_column"])
                    for cell in row.findall(f"{{{MAIN_NS}}}c"):
                        column = cell_column(cell.attrib.get("r", ""))
                        if column in columns:
                            text = read_cell_value(cell, shared_strings)
                            if text:
                                values[column] = text

                    row_number = int(row.attrib.get("r", "0"))
                    project_name = values.get(config["project_name_column"], "")
                    project_numbers = [
                        values[column]
                        for column in config["project_number_columns"]
                        if values.get(column)
                    ]
                    new_project_anchor = (
                        (project_name and not is_note(project_name))
                        or (project_numbers and not project_name)
                    )
                    if new_project_anchor and not (
                        config["role"] == "unclassified"
                        and project_name.casefold().startswith("federal projects as of")
                    ):
                        project_context = {
                            "projectName": project_name,
                            "projectNumbers": project_numbers,
                            "projectAnchorRow": row_number,
                        }

                    def add_relationship(role: str, value: str) -> None:
                        value = clean_relationship_value(value)
                        if not value or value in {
                            "Prime Contractor",
                            "Subs",
                            "Contractor",
                        } or is_note(value):
                            return
                        relationships.append({
                            "sourceSheet": sheet_name,
                            "sourceRow": row_number,
                            "projectAnchorRow": project_context["projectAnchorRow"],
                            "projectName": project_context["projectName"],
                            "projectNumbers": project_context["projectNumbers"],
                            "role": role,
                            "contractorName": value,
                            "sourceValue": value,
                        })

                    if config["role"] == "columns":
                        add_relationship("primary", values.get(config["primary_column"], ""))
                        add_relationship("subcontractor", values.get(config["subcontractor_column"], ""))
                    else:
                        add_relationship("unclassified", values.get(config["contractor_column"], ""))
                    row.clear()
    return relationships


def main() -> int:
    if len(sys.argv) != 3:
        print("Usage: extract_sv_proj_relationships.py INPUT.xlsx OUTPUT.json", file=sys.stderr)
        return 2
    input_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    records = extract(input_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Extracted {len(records)} contractor/source rows to {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
