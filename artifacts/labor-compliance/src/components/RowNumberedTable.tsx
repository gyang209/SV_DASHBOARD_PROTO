import {
  default as React,
  Children,
  cloneElement,
  Fragment,
  isValidElement,
  useState,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  type TableHTMLAttributes,
} from "react";
import { RecordRowActions, type RecordRowActionsProps } from "./RecordRowActions";

type RowProps = {
  children?: ReactNode;
  className?: string;
  hidden?: boolean;
  onClick?: (event: MouseEvent<HTMLTableRowElement>) => void;
  "aria-selected"?: boolean;
  "data-testid"?: string;
  "data-row-count-ignore"?: boolean;
};

type SectionProps = { children?: ReactNode };
type CellProps = { children?: ReactNode; className?: string };

function hasClassName(className: string | undefined, expected: string): boolean {
  return Boolean(className?.split(/\s+/).includes(expected));
}

function isRecordActionNode(node: ReactNode): node is ReactElement<RecordRowActionsProps> {
  return isValidElement(node) && node.type === RecordRowActions;
}

function hasContentBesidesRecordActions(children: ReactNode): boolean {
  return Children.toArray(children).some((child) => {
    if (isRecordActionNode(child)) return false;
    if (isValidElement(child) && child.type === Fragment) {
      return hasContentBesidesRecordActions((child.props as SectionProps).children);
    }
    return typeof child === "string" ? child.trim().length > 0 : child !== null && child !== undefined;
  });
}

function shouldRemoveActionsColumn(children: ReactNode): boolean {
  let foundRecordActions = false;
  let hasOtherActionCellContent = false;

  const inspectBody = (bodyChildren: ReactNode) => {
    Children.toArray(bodyChildren).forEach((child) => {
      if (!isValidElement(child)) return;
      if (child.type === Fragment) {
        inspectBody((child.props as SectionProps).children);
        return;
      }
      if (child.type !== "tr") return;

      Children.toArray((child.props as RowProps).children).forEach((cell) => {
        if (!isValidElement(cell) || cell.type !== "td") return;
        const cellProps = cell.props as CellProps;
        if (!hasClassName(cellProps.className, "record-actions-cell")) return;
        const cellChildren = Children.toArray(cellProps.children);
        if (cellChildren.some(isRecordActionNode)) foundRecordActions = true;
        if (hasContentBesidesRecordActions(cellProps.children)) hasOtherActionCellContent = true;
      });
    });
  };

  Children.toArray(children).forEach((child) => {
    if (!isValidElement(child)) return;
    if (child.type === "tbody") inspectBody((child.props as SectionProps).children);
    else if (child.type === Fragment) inspectBody((child.props as SectionProps).children);
  });

  return foundRecordActions && !hasOtherActionCellContent;
}

function addColumnNumbers(children: ReactNode, removeActionsColumn: boolean): ReactNode {
  const columnGroups = Children.toArray(children).filter(
    (child) => isValidElement(child) && child.type === "colgroup",
  ).length;
  if (!columnGroups) return children;

  let currentGroup = 0;
  return Children.map(children, (child) => {
    if (!isValidElement(child) || child.type !== "colgroup") return child;
    const group = currentGroup++;
    const columns = Children.toArray((child.props as SectionProps).children);
    if (removeActionsColumn && group === columnGroups - 1) columns.pop();
    const numberedColumns = [
      ...(group === 0 ? [
        <col key="row-number-left" className="row-number-column row-number-left" style={{ width: 34, minWidth: 34, maxWidth: 34 }} />,
      ] : []),
      ...columns,
      ...(group === columnGroups - 1 ? [
        <col key="row-number-right" className="row-number-column row-number-right" style={{ width: 34, minWidth: 34, maxWidth: 34 }} />,
      ] : []),
    ];
    return cloneElement(child as ReactElement<SectionProps>, {}, [
      ...numberedColumns,
    ]);
  });
}

function countHeaderRows(children: ReactNode): number {
  return Children.toArray(children).reduce<number>((count, child) => {
    if (!isValidElement(child)) return count;
    if (child.type === "tr") return count + 1;
    if (child.type === Fragment) return count + countHeaderRows((child.props as SectionProps).children);
    return count;
  }, 0);
}

function getNodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(getNodeText).join("");
  if (isValidElement(node)) return getNodeText((node.props as SectionProps).children);
  return "";
}

function isActionsHeader(node: ReactNode): boolean {
  return isValidElement(node)
    && node.type === "th"
    && getNodeText((node.props as SectionProps).children).trim().toLowerCase() === "actions";
}

function addHeaderNumbers(
  children: ReactNode,
  rowSpan: number,
  inserted: { value: boolean },
  removeActionsColumn: boolean,
): ReactNode {
  return Children.map(children, (child) => {
    if (!isValidElement(child)) return child;
    if (child.type === Fragment) {
      const fragment = child as ReactElement<SectionProps>;
      return cloneElement(fragment, {
        children: addHeaderNumbers(fragment.props.children, rowSpan, inserted, removeActionsColumn),
      });
    }
    if (child.type !== "tr") return child;
    const cells = Children.toArray((child.props as RowProps).children)
      .filter((cell) => !removeActionsColumn || !isActionsHeader(cell));
    if (inserted.value) return cloneElement(child as ReactElement<RowProps>, {}, cells);
    inserted.value = true;
    return cloneElement(child as ReactElement<RowProps>, {}, [
      <th key="row-number-left" className="row-number-header row-number-left" scope="col" rowSpan={rowSpan} aria-label="Row number" style={{ width: 34, minWidth: 34, maxWidth: 34 }}>Row</th>,
      ...cells,
      <th key="row-number-right" className="row-number-header row-number-right" scope="col" rowSpan={rowSpan} aria-label="Row number" style={{ width: 34, minWidth: 34, maxWidth: 34 }}>Row</th>,
    ]);
  });
}

function actionNodesForPlacement(
  actions: ReactElement<RecordRowActionsProps>[],
  placement: "left" | "right",
): ReactNode[] {
  return actions.map((action, index) => cloneElement(action, {
    key: `${action.key ?? "record-row-action"}-${placement}-${index}`,
    placement,
  }));
}

function stripRecordActions(children: ReactNode): {
  children: ReactNode;
  actions: ReactElement<RecordRowActionsProps>[];
} {
  const actions: ReactElement<RecordRowActionsProps>[] = [];
  const remaining = Children.map(children, (child) => {
    if (!isValidElement(child)) return child;
    if (isRecordActionNode(child)) {
      actions.push(child);
      return null;
    }
    if (child.type === Fragment) {
      const fragment = child as ReactElement<SectionProps>;
      const nested = stripRecordActions(fragment.props.children);
      actions.push(...nested.actions);
      return cloneElement(fragment, { children: nested.children });
    }
    return child;
  });
  return { children: remaining, actions };
}

function addBodyNumbers(
  children: ReactNode,
  selectedKey: string | null,
  setSelectedKey: (key: string) => void,
  rowCount: { value: number },
  removeActionsColumn: boolean,
): ReactNode {
  return Children.map(children, (child) => {
    if (!isValidElement(child)) return child;
    if (child.type === Fragment) {
      const fragment = child as ReactElement<SectionProps>;
      return cloneElement(fragment, {
        children: addBodyNumbers(fragment.props.children, selectedKey, setSelectedKey, rowCount, removeActionsColumn),
      });
    }
    if (child.type !== "tr") return child;

    const row = child as ReactElement<RowProps>;
    const originalClassName = row.props.className ?? "";
    const isDetailRow = Boolean(
      row.props.hidden
      || row.props["data-row-count-ignore"]
      || originalClassName.includes("trash-affected-row")
      || originalClassName.includes("contractor-directory-details-row"),
    );
    const number = isDetailRow ? null : ++rowCount.value;
    const key = String(row.props["data-testid"] ?? row.key ?? `row-${number ?? rowCount.value}`);
    const selected = !isDetailRow && selectedKey === key;
    const className = [
      originalClassName,
      isDetailRow ? "row-numbered-detail" : "row-numbered-record",
      selected ? "is-row-selected" : "",
    ].filter(Boolean).join(" ");
    const onClick = (event: MouseEvent<HTMLTableRowElement>) => {
      if (!isDetailRow) setSelectedKey(key);
      row.props.onClick?.(event);
    };
    const rowActions: ReactElement<RecordRowActionsProps>[] = [];
    const rowChildren = Children.toArray(row.props.children).flatMap((cell) => {
      if (!isValidElement(cell) || cell.type !== "td") return [cell];
      const cellProps = cell.props as CellProps;
      if (!hasClassName(cellProps.className, "record-actions-cell")) return [cell];
      const stripped = stripRecordActions(cellProps.children);
      rowActions.push(...stripped.actions);
      if (removeActionsColumn) return [];
      return [cloneElement(cell as ReactElement<CellProps>, {}, stripped.children)];
    });
    const leftActions = actionNodesForPlacement(rowActions, "left");
    const rightActions = actionNodesForPlacement(rowActions, "right");
    const rowNumberCell = (actions: ReactNode[]) => (
      <div className="row-number-cell-content">
        <span className="row-number-value">{number ?? ""}</span>
        {actions.length > 0 && <div className="row-number-cell-actions">{actions}</div>}
      </div>
    );

    return cloneElement(row, {
      className,
      onClick,
      "aria-selected": isDetailRow ? undefined : selected,
    }, [
      <th key="row-number-left" className={`row-number-cell row-number-left${selected ? " is-highlighted" : ""}`} scope="row" data-label="Row" aria-label={number ? `Row ${number}` : undefined} style={{ width: 34, minWidth: 34, maxWidth: 34 }}>{rowNumberCell(leftActions)}</th>,
      ...rowChildren,
      <td key="row-number-right" className={`row-number-cell row-number-right${selected ? " is-highlighted" : ""}`} data-label="Row" aria-label={number ? `Row ${number} actions` : undefined} style={{ width: 34, minWidth: 34, maxWidth: 34 }}>{rowNumberCell(rightActions)}</td>,
    ]);
  });
}

export function RowNumberedTable({
  children,
  className,
  ...props
}: TableHTMLAttributes<HTMLTableElement>) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const rowCount = { value: 0 };
  const removeActionsColumn = shouldRemoveActionsColumn(children);
  const headerRows = Children.toArray(children).reduce<number>((count, child) => {
    if (!isValidElement(child)) return count;
    if (child.type === "thead") return count + countHeaderRows((child.props as SectionProps).children);
    return count;
  }, 0);

  const numberedChildren = Children.map(addColumnNumbers(children, removeActionsColumn), (child) => {
    if (!isValidElement(child)) return child;
    if (child.type === "thead") {
      const section = child as ReactElement<SectionProps>;
      return cloneElement(section, {
        children: addHeaderNumbers(
          section.props.children,
          Math.max(headerRows, 1),
          { value: false },
          removeActionsColumn,
        ),
      });
    }
    if (child.type === "tbody") {
      const section = child as ReactElement<SectionProps>;
      return cloneElement(section, {
        children: addBodyNumbers(
          section.props.children,
          selectedKey,
          setSelectedKey,
          rowCount,
          removeActionsColumn,
        ),
      });
    }
    return child;
  });

  return <table {...props} className={`${className ?? ""} row-numbered-table`.trim()}>{numberedChildren}</table>;
}
