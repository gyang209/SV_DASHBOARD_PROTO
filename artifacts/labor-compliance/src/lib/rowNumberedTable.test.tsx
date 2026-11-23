import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RowNumberedTable } from "@/components/RowNumberedTable";
import { RecordRowActions } from "@/components/RecordRowActions";

test("row-numbered tables add mirrored row columns and skip expanded detail rows", () => {
  const html = renderToStaticMarkup(
    createElement(RowNumberedTable, { className: "data-table" },
      createElement("thead", null,
        createElement("tr", null,
          createElement("th", null, "Project"),
          createElement("th", null, "Contractor"),
        ),
      ),
      createElement("tbody", null,
        createElement(Fragment, null,
          createElement("tr", { "data-testid": "project-1" },
            createElement("td", null, "Project One"),
            createElement("td", null, "Contractor One"),
          ),
          createElement("tr", { className: "trash-affected-row" },
            createElement("td", { colSpan: 2 }, "Affected record details"),
          ),
          createElement("tr", { "data-testid": "project-2" },
            createElement("td", null, "Project Two"),
            createElement("td", null, "Contractor Two"),
          ),
        ),
      ),
    ),
  );

  assert.equal((html.match(/class="row-number-header/g) ?? []).length, 2);
  assert.match(html, /row-number-left[^>]*><div class="row-number-cell-content"><span class="row-number-value">1<\/span>/);
  assert.match(html, /row-number-right[^>]*><div class="row-number-cell-content"><span class="row-number-value">1<\/span>/);
  assert.match(html, /row-number-left[^>]*><div class="row-number-cell-content"><span class="row-number-value">2<\/span>/);
  assert.match(html, /row-number-right[^>]*><div class="row-number-cell-content"><span class="row-number-value">2<\/span>/);
  assert.equal((html.match(/row-number-cell row-number-left/g) ?? []).length, 3);
  assert.equal((html.match(/row-number-cell row-number-right/g) ?? []).length, 3);
  assert.equal((html.match(/width:34px;min-width:34px;max-width:34px/g) ?? []).length, 8);
});

test("row action buttons stack below the number on both sides and replace the Actions column", () => {
  const html = renderToStaticMarkup(
    createElement(RowNumberedTable, { className: "data-table" },
      createElement("thead", null,
        createElement("tr", null,
          createElement("th", null, "Project"),
          createElement("th", null, "Actions"),
        ),
      ),
      createElement("tbody", null,
        createElement("tr", { "data-testid": "project-1" },
          createElement("td", null, "Project One"),
          createElement("td", { className: "record-actions-cell" },
            createElement(RecordRowActions, {
              recordType: "project",
              recordId: 9,
              title: "Project One",
              onEdit: () => {},
              onDelete: () => {},
            }),
          ),
        ),
      ),
    ),
  );

  assert.doesNotMatch(html, />Actions<\/th>/);
  assert.doesNotMatch(html, /class="record-actions-cell"/);
  assert.equal((html.match(/aria-label="Edit Project One"/g) ?? []).length, 2);
  assert.equal((html.match(/aria-label="Delete Project One"/g) ?? []).length, 2);
  assert.match(
    html,
    /row-number-value">1<\/span><div class="row-number-cell-actions"><div class="record-row-actions"><button[^>]*data-testid="button-edit-project-9"[^>]*>.*?<button[^>]*data-testid="button-delete-project-9"[^>]*>/,
  );
  assert.match(html, /data-testid="button-edit-project-9-right"/);
  assert.match(html, /data-testid="button-delete-project-9-right"/);
});

test("row actions move while non-action controls stay in a shared Actions cell", () => {
  const html = renderToStaticMarkup(
    createElement(RowNumberedTable, { className: "data-table" },
      createElement("thead", null,
        createElement("tr", null,
          createElement("th", null, "Project"),
          createElement("th", null, "Actions"),
        ),
      ),
      createElement("tbody", null,
        createElement("tr", null,
          createElement("td", null, "Project One"),
          createElement("td", { className: "record-actions-cell" },
            createElement(RecordRowActions, {
              recordType: "project",
              recordId: 9,
              title: "Project One",
              onEdit: () => {},
              onDelete: () => {},
            }),
            createElement("button", { type: "button", className: "save-action" }, "Save"),
          ),
        ),
      ),
    ),
  );

  assert.match(html, />Actions<\/th>/);
  assert.match(html, /class="record-actions-cell"><button[^>]*class="save-action"[^>]*>Save<\/button><\/td>/);
  assert.equal((html.match(/aria-label="Edit Project One"/g) ?? []).length, 2);
  assert.equal((html.match(/aria-label="Delete Project One"/g) ?? []).length, 2);
});

test("row-numbered tables add fixed-width columns around an existing colgroup", () => {
  const html = renderToStaticMarkup(
    createElement(RowNumberedTable, { className: "data-table", style: { tableLayout: "fixed" } },
      createElement("colgroup", null,
        createElement("col", { style: { width: "50%" } }),
        createElement("col", { style: { width: "50%" } }),
      ),
      createElement("thead", null, createElement("tr", null, createElement("th", null, "Project"), createElement("th", null, "Contractor"))),
      createElement("tbody", null, createElement("tr", null, createElement("td", null, "Project One"), createElement("td", null, "Contractor One"))),
    ),
  );

  assert.match(html, /<col class="row-number-column row-number-left" style="width:34px;min-width:34px;max-width:34px"\/>/);
  assert.match(html, /class="row-number-column row-number-right" style="width:34px;min-width:34px;max-width:34px"\/>/);
  assert.equal((html.match(/class="row-number-column/g) ?? []).length, 2);
});

test("row-numbered columns retain centered padding and sizing rules", () => {
  const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
  assert.match(css, /\.row-numbered-table \.row-number-header,\.row-numbered-table \.row-number-cell\{[^}]*width:34px;min-width:34px;max-width:34px;[^}]*padding:7px 2px!important;text-align:center!important/);
  assert.match(css, /\.row-numbered-table col\.row-number-column\{[^}]*width:34px!important/);
});
