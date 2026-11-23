import assert from "node:assert/strict";
import { test } from "node:test";
import { Children, isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RecordRowActions } from "@/components/RecordRowActions";

test("record row actions expose accessible edit and delete controls and call their handlers", () => {
  const calls: string[] = [];
  const props = {
    recordType: "project" as const,
    recordId: 42,
    title: "Library Renovation",
    onEdit: () => calls.push("edit"),
    onDelete: (recordType: string, id: number, title: string) => calls.push(`delete:${recordType}:${id}:${title}`),
  };
  const actions = RecordRowActions(props);
  const html = renderToStaticMarkup(actions);
  const buttons = Children.toArray(actions.props.children) as ReactElement<{ onClick: () => void }>[];

  assert.match(html, /aria-label="Edit Library Renovation"/);
  assert.match(html, /aria-label="Delete Library Renovation"/);
  assert.match(html, /data-testid="button-edit-project-42"/);
  assert.match(html, /data-testid="button-delete-project-42"/);
  assert.equal(buttons.length, 2);
  assert.ok(isValidElement(buttons[0]));
  assert.ok(isValidElement(buttons[1]));
  buttons[0].props.onClick();
  buttons[1].props.onClick();
  assert.deepEqual(calls, ["edit", "delete:project:42:Library Renovation"]);
});

test("record action controls cover each existing Trash-supported row type", () => {
  const recordTypes = ["project", "contractor", "withholding", "restitution", "sourceRow"] as const;

  for (const recordType of recordTypes) {
    const actions = RecordRowActions({
      recordType,
      recordId: 8,
      title: "Record",
      onEdit: () => {},
      onDelete: () => {},
    });
    const html = renderToStaticMarkup(actions);
    assert.match(html, new RegExp(`data-testid="button-edit-${recordType}-8"`));
    assert.match(html, new RegExp(`data-testid="button-delete-${recordType}-8"`));
    assert.match(html, /aria-label="Edit Record"/);
    assert.match(html, /aria-label="Delete Record"/);
  }
});
