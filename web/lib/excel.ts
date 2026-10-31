// Reads the "ER TO IP" sheet (by name, else the second sheet) from an uploaded workbook in the browser.
import { readSheet } from "read-excel-file/browser";

export async function readAdmissionsSheet(file: File): Promise<unknown[][]> {
  try {
    return (await readSheet(file, "ER TO IP")) as unknown[][];
  } catch {
    const rows = (await readSheet(file, 2).catch(() => readSheet(file, 1))) as unknown[][];
    return rows;
  }
}
