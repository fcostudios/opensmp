"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { DataTable } from "@smp/ui";

import {
  AUDIT_TIME_ZONE,
  type AuditListItem,
} from "@/modules/audit/types";
import { AuditDiffDialog } from "./audit-diff-dialog";

interface AuditTableLabels {
  readonly action: string;
  readonly actor: string;
  readonly added: string;
  readonly after: string;
  readonly before: string;
  readonly close: string;
  readonly company: string;
  readonly details: string;
  readonly empty: string;
  readonly entity: string;
  readonly next: string;
  readonly note: string;
  readonly occurredAt: string;
  readonly removed: string;
  readonly systemActor: string;
}

export interface AuditTableProps {
  readonly filterQuery?: Readonly<Record<string, string>>;
  readonly items: readonly AuditListItem[];
  readonly labels: AuditTableLabels;
  readonly locale: string;
  readonly nextCursor: string | null;
}

function shortId(id: string): string {
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

export function AuditTable({
  filterQuery = {},
  items,
  labels,
  locale,
  nextCursor,
}: AuditTableProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const returnFocusRef = useRef<HTMLTableRowElement | null>(null);
  const selected = items.find(({ id }) => id === selectedId) ?? null;
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: AUDIT_TIME_ZONE,
  });
  const nextParams = new URLSearchParams(filterQuery);
  if (nextCursor) nextParams.set("cursor", nextCursor);

  return (
    <section
      className="rounded border border-border bg-surface"
      data-testid="table_audit"
    >
      <DataTable
        caption={labels.details}
        columns={[
          { id: "occurredAt", label: labels.occurredAt },
          { id: "actor", label: labels.actor },
          { id: "action", label: labels.action },
          { id: "entity", label: labels.entity },
          { id: "company", label: labels.company },
        ]}
        emptyLabel={labels.empty}
        onRowClick={(id, trigger) => {
          returnFocusRef.current = trigger;
          setSelectedId(id);
        }}
        rows={items.map((item) => ({
          id: item.id,
          cells: {
            occurredAt: dateFormatter.format(new Date(item.occurredAt)),
            actor: item.actorEmail ?? labels.systemActor,
            action: item.action,
            entity: item.entityHref ? (
              <Link
                className="text-primary underline"
                href={item.entityHref}
                onClick={(event) => event.stopPropagation()}
              >
                {item.entityType} · {shortId(item.entityId)}
              </Link>
            ) : (
              `${item.entityType} · ${shortId(item.entityId)}`
            ),
            company:
              item.companyName && item.companyCode
                ? `${item.companyName} (${item.companyCode})`
                : "—",
          },
        }))}
      />
      {nextCursor ? (
        <Link
          className="m-4 inline-flex min-h-11 items-center rounded border border-border px-4"
          href={`?${nextParams.toString()}`}
        >
          {labels.next}
        </Link>
      ) : null}
      {selected ? (
        <AuditDiffDialog
          item={selected}
          labels={labels}
          locale={locale}
          onClose={() => {
            const trigger = returnFocusRef.current;
            setSelectedId(null);
            queueMicrotask(() => trigger?.focus());
          }}
          open
        />
      ) : null}
    </section>
  );
}
