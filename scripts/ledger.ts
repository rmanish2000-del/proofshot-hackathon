// npm run ledger
//
// CAP1b: prints each spend ledger outside the repo (%LOCALAPPDATA%\ProofShot):
// calls, spent, what a batch may still spend, and what is left of the reserve
// (opt-in only, PROOFSHOT_USE_RESERVE=1). Amounts only.

import { FIREWORKS_LIMIT, fireworksLedger } from "../src/fireworks-copy.ts";
import { SPEND_CAP_USD, defaultLedgerPath, fileLedger } from "../src/render-replicate.ts";
import { BASETEN_LIMIT, META_LIMIT, accountLedger, spendSummary, summaryLine } from "../src/spend-meta.ts";

const replicatePath = defaultLedgerPath(process.env);
const rows = [
  { name: "fireworks", ledger: fireworksLedger(process.env), limit: FIREWORKS_LIMIT },
  { name: "meta (api.meta.ai credit)", ledger: accountLedger("meta", process.env), limit: META_LIMIT },
  { name: "baseten", ledger: accountLedger("baseten", process.env), limit: BASETEN_LIMIT },
  { name: "replicate", ledger: replicatePath ? fileLedger(replicatePath) : null, limit: { cap_usd: SPEND_CAP_USD, reserve_usd: 0 } },
];
for (const r of rows) {
  console.log(r.ledger ? summaryLine(r.name, spendSummary(r.ledger, r.limit)) : `${r.name}: no ledger path (LOCALAPPDATA is not set)`);
}
