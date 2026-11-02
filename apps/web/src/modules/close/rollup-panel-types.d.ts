import type messages from "../../../messages/en-US.json";
export type RollupDownload = { csv: string; filename: string };
export interface RollupPanelProps {
  period: string;
  reconciliationTotalUsd: string;
  ties: boolean;
  action: (period: string) => Promise<RollupDownload>;
  t: typeof messages.rollup;
}
