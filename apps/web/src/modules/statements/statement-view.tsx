import Link from "next/link";
import { ROUTE_SCR_STATEMENTS, ROUTE_SCR_STATEMENT_DETAIL } from "@/lib/routes";
import type messages from "../../../messages/en-US.json";
import type { StatementFilters } from "@smp/contracts/statements";
import type { StatementRegister } from "./repository";

type Labels = typeof messages.statements;
type Row = StatementRegister["rows"][number];

function Movements({ items, t }: { items: Row["joiners"]; t: Labels }) {
  return <ul>{items.map(item => <li key={item.assignmentId}>
    <span className="font-mono">{item.personId}</span>{" · "}<time>{item.date}</time>
    <small className="block font-mono">{item.assignmentId}</small>
  </li>)}{items.length === 0 && <li>{t.none}</li>}</ul>;
}

export function StatementTable({ data, t }: { data: StatementRegister; t: Labels }) {
  return <section data-testid="statements_table" className="overflow-x-auto rounded-lg border border-border">
    {data.rows.length === 0 ? <p data-testid="statements_empty" className="p-4">{t.empty}{" · "}{data.period}</p> :
      <table className="w-full text-sm">
        <caption className="p-4 text-left">{t.evidenceNote}</caption>
        <thead><tr>{[t.company,t.period,t.status,t.openingSeats,t.joiners,t.leavers,t.seatDays,t.rate,t.total,t.generatedAt,t.statementId,t.closeRun].map(label => <th key={label} scope="col" className="p-2 text-left">{label}</th>)}</tr></thead>
        <tbody>{data.rows.map(row => <tr key={row.id} data-testid={`statement-${row.id}`} className="border-t border-border">
          <td className="p-2"><span className="font-mono">{row.companyCode}</span><p>{row.companyName}</p></td>
          <td className="p-2">{row.period}</td>
          <td className="p-2"><span className="rounded border border-border px-2 py-1">{t[row.status]}</span></td>
          <td className="p-2 font-mono">{row.openingSeats}</td>
          <td className="p-2"><Movements items={row.joiners} t={t}/></td>
          <td className="p-2"><Movements items={row.leavers} t={t}/></td>
          <td className="p-2 font-mono">{row.seatDays}</td>
          <td className="p-2 font-mono">{row.rates.length ? row.rates.join(" · ") : t.none}</td>
          <td className="p-2 font-mono">{row.totalUsd}</td>
          <td className="p-2"><time>{row.generatedAt.toISOString()}</time></td>
          <td className="p-2"><Link className="block font-mono underline" href={ROUTE_SCR_STATEMENT_DETAIL.replace(":statementId", row.id)}>{row.id}</Link>
            <a className="underline" href={`/api/v1/statements/${row.id}/export/csv`}>{t.csv}</a>{" · "}<a className="underline" href={`/api/v1/statements/${row.id}/export/pdf`}>{t.pdf}</a></td>
          <td className="p-2 font-mono">{row.closeRunId ?? t.none}</td>
        </tr>)}</tbody>
      </table>}
  </section>;
}

export function StatementSummary({ data, t }: { data: StatementRegister; t: Labels }) {
  return <section data-testid="close_tiles" className="space-y-4">
    <dl className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {([
        ["tile_current_period",t.period,data.period],
        ["tile_statements_generated",t.generated,data.totals.generated],
        ["tile_drafts",t.drafts,data.totals.draft],
        ["tile_finals",t.finals,data.totals.final],
        ["tile_reconciled",t.reconciledCount,data.totals.reconciled],
        ["tile_group_total",t.groupTotal,data.totals.totalUsd],
      ] as const).map(([id,label,value]) => <div key={id} data-testid={id} className="rounded-lg border border-border p-4"><dt>{label}</dt><dd className="font-mono text-xl">{value}</dd></div>)}
    </dl>
    <Link data-testid="btn_view_statements" className="underline" href={`${ROUTE_SCR_STATEMENTS}?period=${data.period}`}>{t.viewStatements}</Link>
  </section>;
}

export function StatementsView({ data, filters, canFilterCompany, t }: { data: StatementRegister; filters: StatementFilters; canFilterCompany: boolean; t: Labels }) {
  return <div className="space-y-6 p-6">
    <header><h1 className="text-2xl font-bold">{t.title}</h1><p>{t.subtitle}</p></header>
    <form action={ROUTE_SCR_STATEMENTS} method="get" data-testid="statements_filters" className="flex flex-wrap items-end gap-4">
      <label>{t.period}<input data-testid="filter_period" aria-label={t.period} name="period" type="month" defaultValue={filters.period} required className="block rounded border border-border p-2"/></label>
      {canFilterCompany && <label>{t.company}<select data-testid="filter_company" aria-label={t.company} name="companyId" defaultValue={filters.companyId} className="block rounded border border-border p-2"><option value="">{t.all}</option>{data.companies.map(c => <option key={c.id} value={c.id}>{c.code}{" · "}{c.name}</option>)}</select></label>}
      <label>{t.status}<select data-testid="filter_status" aria-label={t.status} name="status" defaultValue={filters.status} className="block rounded border border-border p-2"><option value="">{t.all}</option>{(["draft","final","reconciled"] as const).map(status => <option key={status} value={status}>{t[status]}</option>)}</select></label>
      <button type="submit" className="rounded border border-border px-4 py-2">{t.select}</button>
    </form>
    <section data-testid="statements_latest_run" className="rounded-lg border border-border p-4"><h2 className="font-semibold">{t.latest}</h2><p>{data.period}</p>
      {data.latest ? <p role={data.latest.status === "failed" ? "alert" : "status"}>{t[data.latest.status]}{" · "}{data.period}{" · "}{data.latest.id}{" · "}<time>{data.latest.startedAt.toISOString()}</time></p> : <p>{t.noRun}</p>}
    </section>
    <StatementTable data={data} t={t}/>
    <p data-testid="scope_note" className="rounded-lg border border-border p-4">{t.scopeNote}</p>
  </div>;
}
