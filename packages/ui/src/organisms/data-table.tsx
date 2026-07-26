import type { ReactNode } from "react";

export interface DataTableColumn {
  readonly id: string;
  readonly label: string;
}

export interface DataTableRow {
  readonly id: string;
  readonly cells: Readonly<Record<string, ReactNode>>;
}

export interface DataTableProps {
  readonly caption: string;
  readonly columns: readonly DataTableColumn[];
  readonly emptyLabel: string;
  readonly rows: readonly DataTableRow[];
  readonly onRowClick?: (
    id: string,
    trigger: HTMLTableRowElement,
  ) => void;
}

export function isRowActivationKey(key: string): boolean {
  return key === "Enter" || key === " ";
}

export function DataTable({
  caption,
  columns,
  emptyLabel,
  onRowClick,
  rows,
}: DataTableProps) {
  return (
    <div className="overflow-x-auto" data-organism="data-table">
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-border">
            {columns.map((column) => (
              <th
                className="px-4 py-3 text-sm font-semibold text-text-secondary"
                key={column.id}
                scope="col"
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                className="px-4 py-10 text-center text-text-secondary"
                colSpan={columns.length}
              >
                {emptyLabel}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                className="border-b border-border"
                key={row.id}
                onClick={
                  onRowClick
                    ? (event) => {
                        onRowClick(row.id, event.currentTarget);
                      }
                    : undefined
                }
                onKeyDown={
                  onRowClick
                    ? (event) => {
                        if (
                          event.target !== event.currentTarget ||
                          !isRowActivationKey(event.key)
                        ) {
                          return;
                        }
                        event.preventDefault();
                        onRowClick(row.id, event.currentTarget);
                      }
                    : undefined
                }
                tabIndex={onRowClick ? 0 : undefined}
              >
                {columns.map((column) => (
                  <td className="px-4 py-3 align-top" key={column.id}>
                    {row.cells[column.id]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
