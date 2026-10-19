/**
 * UCF — log validasi.
 * Setiap tes menyimpan nama, model, hasil, error, peringatan, waktu, dan info teknis.
 * NOT TESTED tidak pernah diperlakukan sebagai PASS.
 */

export const RESULT = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  NOT_TESTED: 'NOT TESTED',
  BLOCKED: 'BLOCKED'
});

const VALID_RESULTS = new Set(Object.values(RESULT));

export class ValidationLog {
  constructor({ clock = () => new Date() } = {}) {
    this.records = [];
    this.clock = clock;
  }

  add({ group = 'Umum', test, model = '—', result, errors = [], warnings = [], details = {} } = {}) {
    if (!test) throw new Error('Nama tes wajib diisi');
    const safeResult = VALID_RESULTS.has(result) ? result : RESULT.NOT_TESTED;
    const record = {
      id: this.records.length + 1,
      group,
      test,
      model,
      result: safeResult,
      errors: [...errors],
      warnings: [...warnings],
      at: this.clock().toISOString(),
      details: { ...details }
    };
    this.records.push(record);
    return record;
  }

  has(test) {
    return this.records.some((record) => record.test === test);
  }

  summary() {
    const summary = { PASS: 0, FAIL: 0, 'NOT TESTED': 0, BLOCKED: 0, total: 0 };
    for (const record of this.records) {
      summary[record.result] += 1;
      summary.total += 1;
    }
    return summary;
  }

  toJSON(environment = {}) {
    return {
      format: 'ucf-validation-log',
      version: '1.0',
      stage: 1,
      generatedAt: this.clock().toISOString(),
      environment,
      summary: this.summary(),
      records: this.records
    };
  }
}

/** Statistik dropdown ringkas untuk badge. */
export function summaryLabel(summary) {
  if (!summary || !summary.total) return '—';
  return `PASS ${summary.PASS} · FAIL ${summary.FAIL}`;
}
