// npm run ledger
//
// CAP1: prints each spend ledger outside the repo (%LOCALAPPDATA%\ProofShot):
// calls, spent, cap, reserve and what is left before the reserve. Amounts only.

import { FIREWORKS_RESERVE_USD, FIREWORKS_SPEND_CAP_USD, fireworksLedger } from "../src/fireworks-copy.ts";
import { SPEND_CAP_USD, defaultLedgerPath, fileLedger } from "../src/render-replicate.ts";
import { META_RESERVE_USD, META_SPEND_CAP_USD, metaLedger, spendSummary } from "../src/spend-meta.ts";

const replicatePath = defaultLedgerPath(process.env);
const rows = [
  { name: "fireworks", ledger: fireworksLedger(process.env), cap: FIREWORKS_SPEND_CAP_USD, reserve: FIREWORKS_RESERVE_USD },
  { name: "meta", ledger: metaLedger(process.env), cap: META_SPEND_CAP_USD, reserve: META_RESERVE_USD },
  { name: "replicate", ledger: replicatePath ? fileLedger(replicatePath) : null, cap: SPEND_CAP_USD, reserve: 0 },
];
for (const r of rows) {
  if (!r.ledger) {
    console.log(`${r.name}: no ledger path (LOCALAPPDATA is not set)`);
    continue;
  }
  const s = spendSummary(r.ledger, r.cap, r.reserve);
  console.log(`${r.name}: ${s.spent_usd} USD in ${s.calls} call(s); cap ${s.cap_usd}, reserve ${s.reserve_usd}, ${s.available_usd} USD left before the reserve`);
}
