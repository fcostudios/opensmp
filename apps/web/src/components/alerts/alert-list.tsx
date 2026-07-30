import {
  AlertList as AlertListOrganism,
  type AlertListItem,
  type AlertListProps,
} from "@smp/ui";
import type { AlertSubjectRef, AlertType } from "@smp/contracts/alerts";
import { alertSubjectDestination } from "@smp/domain/alerts";

export function alertDestination(
  type: unknown,
  subject: unknown,
): string | null {
  try {
    return alertSubjectDestination(
      type as AlertType,
      subject as AlertSubjectRef,
    );
  } catch {
    return null;
  }
}

export function alertScopeText(
  _scopeKind: unknown,
  companyName: string | null,
  labels: {
    readonly company: (name: string) => string;
    readonly global: string;
  },
): string {
  return companyName ? labels.company(companyName) : labels.global;
}

export interface AlertPresentationSource
  extends Omit<AlertListItem, "href"> {
  readonly rawSubject: unknown;
  readonly rawType: unknown;
}

export function AlertList({
  items,
  ...props
}: Omit<AlertListProps, "items"> & {
  readonly items: readonly AlertPresentationSource[];
}) {
  return (
    <AlertListOrganism
      {...props}
      items={items.map(({ rawSubject, rawType, ...item }) => ({
        ...item,
        href: alertDestination(rawType, rawSubject),
      }))}
    />
  );
}
