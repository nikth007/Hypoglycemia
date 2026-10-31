// Loads admission counts from the hospital's ER export into the database.
// Only per-shift counts are stored; no patient rows leave this machine.
// Usage: DATABASE_URL=... npm run seed -- /path/to/ER_Patient_Details.xlsx
import { readSheet } from "read-excel-file/node";
import path from "node:path";
import { aggregate } from "../lib/admissions";
import { dataStatus, saveCounts } from "../lib/db";

const file = process.argv[2];
if (!file) { console.error("usage: npm run seed -- <workbook.xlsx>"); process.exit(1); }

const rows = (await readSheet(file, "ER TO IP")) as unknown[][];
const agg = aggregate(rows);
const n = await saveCounts(agg.counts, {
  source: path.basename(file), firstDay: agg.firstDay, lastDay: agg.lastDay,
  rowsUsed: agg.rowsUsed, rowsSkipped: agg.rowsSkipped,
});
console.log(`saved ${n} shift counts (${agg.firstDay} to ${agg.lastDay}; ${agg.rowsUsed} admissions, ${agg.rowsSkipped} rows skipped)`);
console.log(await dataStatus());
process.exit(0);
