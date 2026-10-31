import { describe, expect, it } from "vitest";
import { aggregate, parseAdmitDate, parseAdmitHour, unitLevel } from "@/lib/admissions";
import { interp } from "@/lib/lgbm";
import { poissonPpf } from "@/lib/forecast";
import { durationDays } from "@/lib/returnRisk";
import { addDays, dayOfWeek, dayOfYear } from "@/lib/dates";

describe("admissions parsing", () => {
  it("groups room codes like the Python pipeline", () => {
    expect(unitLevel("ICU D")).toBe("ICU");
    expect(unitLevel("IMCU A")).toBe("IMCU");
    expect(unitLevel("PIMCU B")).toBe("PIMCU");
    expect(unitLevel("404 AC")).toBe("WARD");
    expect(unitLevel("P-ER A")).toBe("ER_HOLD");
    expect(unitLevel("")).toBe("UNKNOWN");
  });
  it("parses dates and 12-hour times", () => {
    expect(parseAdmitDate("18/03/2023")).toBe("2023-03-18");
    expect(parseAdmitHour("05:26:47 pm")).toBe(17);
    expect(parseAdmitHour("12:10:00 am")).toBe(0);
    expect(parseAdmitHour("12:10:00 pm")).toBe(12);
  });
  it("aggregates rows into shifts and drops the final (partial) day", () => {
    const rows = [
      ["IP NO", "OPMRNO", "OLDROOMNO", "NEWROOM", "ADMISSIONDT", "ADMISSIONTM"],
      ["1", "9", "ER", "ICU A", "01/01/2025", "07:59:00 am"],
      ["2", "9", "ER", "301", "01/01/2025", "08:00:00 am"],
      ["3", "8", "P-ER", "PIMCU A", "02/01/2025", "11:00:00 pm"],
      ["3", "8", "P-ER", "PIMCU A", "02/01/2025", "11:00:00 pm"],
      ["4", "7", "ER", "301", "03/01/2025", "01:00:00 am"],
    ];
    const a = aggregate(rows);
    expect(a.firstDay).toBe("2025-01-01");
    expect(a.lastDay).toBe("2025-01-02");
    expect(a.counts.total["2025-01-01"]).toEqual([1, 1, 0]);
    expect(a.counts.adult_icu_imcu["2025-01-01"]).toEqual([1, 0, 0]);
    expect(a.counts.adult_ward["2025-01-01"]).toEqual([0, 1, 0]);
    expect(a.counts.paediatric["2025-01-02"]).toEqual([0, 0, 1]);
    expect(a.rowsSkipped).toBe(1);
  });
});

describe("maths helpers", () => {
  it("interpolates and clips like numpy", () => {
    expect(interp(-1, [0, 1], [0.1, 0.3])).toBe(0.1);
    expect(interp(0.5, [0, 1], [0.1, 0.3])).toBeCloseTo(0.2);
    expect(interp(2, [0, 1], [0.1, 0.3])).toBe(0.3);
  });
  it("Poisson quantile matches scipy", () => {
    expect(poissonPpf(0.9, 10.6)).toBe(15);
    expect(poissonPpf(0.9, 0.8)).toBe(2);
  });
  it("reads symptom duration", () => {
    expect(durationDays("Fever- 3days")).toBe(3);
    expect(durationDays("cough 2 weeks")).toBe(14);
    expect(Number.isNaN(durationDays("C/O FEVER"))).toBe(true);
  });
  it("calendar helpers", () => {
    expect(dayOfWeek("2026-10-31")).toBe(5);
    expect(dayOfYear("2026-02-01")).toBe(32);
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});
