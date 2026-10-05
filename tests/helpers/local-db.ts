/**
 * Tests that write to a database run only against the local Supabase stack. SUPABASE_DB_URL
 * is also the name of the production secret, so an exported production URL must never be
 * enough to make a test commit rows (scripts/dev-fixtures.ts has the same guard).
 */
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|::1)$/;

/**
 * Country rows the integration tests need, so they pass on an unseeded database (CI runs
 * them before the seed). Real ISO numeric codes keep the later seed conflict-free; insert
 * with ON CONFLICT DO NOTHING and never delete them.
 */
const TEST_COUNTRIES: Record<string, [numeric: string, name: string]> = {
  LA: ["418", "Laos"],
  NP: ["524", "Nepal"],
  MN: ["496", "Mongolia"],
  BT: ["064", "Bhutan"],
  FI: ["246", "Finland"],
  IS: ["352", "Iceland"],
  NO: ["578", "Norway"],
  SE: ["752", "Sweden"],
  DK: ["208", "Denmark"],
};

export function testCountryRows(codes: string[]) {
  return codes.map((iso2) => {
    const entry = TEST_COUNTRIES[iso2];
    if (!entry) throw new Error(`add ${iso2} to TEST_COUNTRIES in tests/helpers/local-db.ts`);
    const [iso_numeric, name] = entry;
    return { iso2, iso_numeric, name, iso_name: name };
  });
}

export function isLocalUrl(url: string | undefined): url is string {
  if (!url) return false;
  try {
    return LOCAL_HOST.test(new URL(url).hostname);
  } catch {
    return false;
  }
}
