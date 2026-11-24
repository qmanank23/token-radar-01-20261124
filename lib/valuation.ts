// radar-2 valuation: the frozen hybrid model for token-radar-01, v2 build.
//
// Every number comes from the sealed snapshot only. No protocol name is
// hardcoded anywhere in this file: the model reads TVL, 7-day growth,
// listing age, category and chain count, and nothing else.
//
//   implied = TVL * (TVL / $1B)^(e - 1) * M_cat * nonTVL
//   nonTVL  = clamp(G * F * C, 0.65, 1.45)
//
// The first factor is the rescaled power law (MODEL-FINAL §0): at e = 0.70 the
// constant ($1B)^0.30 is about 501, so the dollars stay readable while the
// ranking is exactly the ranking of TVL^e * M_cat * nonTVL.

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export interface RowFactors {
  g: number; // winsorized 7d change, percent
  growth: number; // G
  ageYears: number | null;
  ageUnknown: boolean;
  fAge: number;
  health: number;
  maturity: number; // F
  chainFactor: number; // C
  nonTvl: number;
  cappedLow: boolean;
  cappedHigh: boolean;
  catMultiple: number; // M_cat
  catComps: number;
  catLocal: number;
  implied: number;
  neutralImplied: number;
  neutralRank: number;
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  tvl_usd: number;
  change_7d: number | null;
  chains: string[];
  age_years: number | null;
  age_unknown: boolean;
  m_cat: number;
  cat_comps: number;
  cat_local: number;
  growth: number;
  f_age: number;
  health: number;
  maturity: number;
  chain_factor: number;
  nontvl: number;
  capped: string;
  neutral_rank: number;
  capital_usd: number;
  hold_days: number;
  attention: boolean;
  watch_out: string;
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
  ratio: number;
}

export interface RestrictedRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  tag: string;
}

export interface ExcludedRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  reason: string;
}

export interface CategorySummary {
  category: string;
  boardCount: number;
  comps: number;
  localMedian: number;
  multiple: number;
  medianImplied: number;
}

export interface RadarResult {
  board: BoardRow[];
  live: LiveRow[];
  restricted: RestrictedRow[];
  restrictedExtra: RestrictedRow[];
  excluded: ExcludedRow[];
  categories: CategorySummary[];
  fit: { n: number; a: number; b: number; se: number; r2: number; tercileB: number };
  exponent: number;
  exponentTests: { e: number; rho: number; top10Overlap: number; top10MinTvl: number }[];
  globalMultiple: number;
  medianAgeYears: number;
  counts: { protocols: number; watchlist: number; earlyKept: number; earlyExcluded: number; aboveFloorLeftOut: number };
}

export const SNAPSHOT_DATE = "2026-11-14";
export const RESCALE_REF = 1_000_000_000;

// --- small numeric helpers (stdlib only, deterministic) -----------------

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  return n % 2 === 1 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

function quantile(values: number[], q: number): number {
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function spearman(xs: number[], ys: number[]): number {
  const ranks = (arr: number[]): number[] => {
    const order = arr.map((_, i) => i).sort((a, b) => arr[a]! - arr[b]!);
    const r = new Array<number>(arr.length);
    order.forEach((idx, i) => { r[idx] = i + 1; });
    return r;
  };
  const rx = ranks(xs);
  const ry = ranks(ys);
  const n = rx.length;
  const mx = rx.reduce((a, b) => a + b, 0) / n;
  const my = ry.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (rx[i]! - mx) * (ry[i]! - my);
    dx += (rx[i]! - mx) ** 2;
    dy += (ry[i]! - my) ** 2;
  }
  return num / Math.sqrt(dx * dy);
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

// --- snapshot parsing ---------------------------------------------------

export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error("snapshot: protocols and watchlist must be arrays");
  }
  return raw;
}

export function isPreToken(p: Protocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

// --- watchlist exclusions, applied to the early pool too ----------------

const BAD_CATEGORIES = new Set([
  "Bridge",
  "Canonical Bridge",
  "Liquid Staking",
  "Liquid Restaking",
  "Restaked BTC",
  "CEX",
]);
const EXCHANGE_NAMES = ["Binance", "Coinbase", "Bybit", "Kraken", "Bitget", "OKX", "Bitfinex", "Gemini"];

export function exclusionReason(p: Protocol): string | null {
  if (p.category !== null && BAD_CATEGORIES.has(p.category)) return `category is ${p.category}`;
  if (/\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/.test(p.name)) return "name ends in a version marker";
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return "name carries a wrapped / staked word";
  if (/\b(bridg\w*)\b/i.test(p.name)) return "name carries a bridge word";
  if (EXCHANGE_NAMES.some((e) => p.name.startsWith(e))) return "name starts with an exchange name";
  return null;
}

// --- the model ----------------------------------------------------------

const L2_CHAINS = new Set([
  "Arbitrum", "Optimism", "Base", "Polygon", "zkSync Era", "Linea", "Blast",
  "Scroll", "Mantle", "Mode", "Manta", "Starknet", "opBNB",
]);

function ageYearsOf(p: Protocol): number | null {
  if (!p.listed_at) return null;
  const listed = new Date(`${p.listed_at}T00:00:00Z`).getTime();
  const snap = new Date(`${SNAPSHOT_DATE}T00:00:00Z`).getTime();
  return (snap - listed) / 86400000 / 365.25;
}

function ageFactor(age: number | null, medianAge: number): { f: number; unknown: boolean } {
  if (age === null) {
    return { f: 0.35 + (0.65 * medianAge) / (medianAge + 2), unknown: true };
  }
  return { f: 0.35 + (0.65 * age) / (age + 2), unknown: false };
}

export function buildRadar(snap: Snapshot): RadarResult {
  const protocols = snap.protocols;
  const watch = new Set(snap.watchlist);

  // §1 — fit the TVL exponent on live-token comps.
  const comps = protocols.filter(
    (p) => p.gecko_id !== null && p.mcap_usd !== null && p.tvl_usd >= 20_000_000 && p.mcap_usd >= 5_000_000,
  );
  const ratios = comps.map((p) => p.mcap_usd! / p.tvl_usd);
  const lo = quantile(ratios, 0.05);
  const hi = quantile(ratios, 0.95);
  const win = ratios.map((r) => clamp(r, lo, hi));
  const globalMultiple = Math.pow(10, median(win.map((r) => Math.log10(r))));

  const xs = comps.map((p) => Math.log(p.tvl_usd));
  const ys = comps.map((p) => Math.log(p.mcap_usd!));
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
    syy += (ys[i]! - my) ** 2;
  }
  const b = sxy / sxx;
  const a = my - b * mx;
  const r2 = (sxy * sxy) / (sxx * syy);
  const sse = ys.reduce((s, y, i) => s + (y - (a + b * xs[i]!)) ** 2, 0);
  const se = Math.sqrt(sse / (n - 2) / sxx);
  // Tercile fallback (ernie): median multiples, top vs bottom TVL tercile.
  const byTvl = [...comps].sort((x, y) => x.tvl_usd - y.tvl_usd);
  const third = Math.floor(n / 3);
  const lowT = byTvl.slice(0, third);
  const highT = byTvl.slice(n - third);
  const tercileB =
    1 + Math.log(median(highT.map((p) => p.mcap_usd! / p.tvl_usd)) / median(lowT.map((p) => p.mcap_usd! / p.tvl_usd))) /
      Math.log(median(highT.map((p) => p.tvl_usd)) / median(lowT.map((p) => p.tvl_usd)));

  // §2 — category multiples: log-median, winsorized, shrunk toward global (k = 8), capped.
  const byCat = new Map<string, number[]>();
  for (const p of comps) {
    const key = p.category ?? "(none)";
    const arr = byCat.get(key) ?? [];
    arr.push(clamp(p.mcap_usd! / p.tvl_usd, lo, hi));
    byCat.set(key, arr);
  }
  const catInfo = new Map<string, { multiple: number; comps: number; local: number }>();
  for (const [cat, rs] of byCat) {
    const local = Math.pow(10, median(rs.map((r) => Math.log10(r))));
    const shrunk = (rs.length * local + 8 * globalMultiple) / (rs.length + 8);
    catInfo.set(cat, { multiple: clamp(shrunk, 0.1, 1.2), comps: rs.length, local });
  }
  const multipleOf = (p: Protocol): { multiple: number; comps: number; local: number } => {
    const info = catInfo.get(p.category ?? "(none)");
    if (info) return info;
    return { multiple: globalMultiple, comps: 0, local: globalMultiple };
  };

  // Median watchlist age, for the two protocols with no listed_at.
  const watchAges = protocols
    .filter((p) => watch.has(p.slug) && p.listed_at)
    .map((p) => ageYearsOf(p)!);
  const medianAgeYears = median(watchAges);

  const factors = (p: Protocol): RowFactors => {
    // A null 7-day change (4 protocols in the snapshot, none on the
    // watchlist) is treated as 0% — neutral growth, stated in the detail view.
    const g = clamp(p.change_7d ?? 0, -60, 120);
    const growth = 1 + (0.35 * g) / 120;
    const age = ageYearsOf(p);
    const { f, unknown } = ageFactor(age, medianAgeYears);
    const health = 1 - (0.1 * Math.max(0, -g)) / 60;
    const maturity = f * health;
    const chainFactor = 1 + 0.1 * Math.min(Math.log10(Math.max(1, p.chains.length)) / Math.log10(11), 1);
    const raw = growth * maturity * chainFactor;
    const nonTvl = clamp(raw, 0.65, 1.45);
    const { multiple, comps: catComps, local } = multipleOf(p);
    return {
      g, growth, ageYears: age, ageUnknown: unknown, fAge: f, health,
      maturity, chainFactor, nonTvl,
      cappedLow: raw < 0.65, cappedHigh: raw > 1.45,
      catMultiple: multiple, catComps, catLocal: local, implied: 0, neutralImplied: 0, neutralRank: 0,
    };
  };

  const impliedAt = (p: Protocol, e: number, f: RowFactors, mult: number): number =>
    p.tvl_usd * Math.pow(p.tvl_usd / RESCALE_REF, e - 1) * mult * f.nonTvl;

  // Board candidates: the 40 watchlist rows plus the early pool.
  const watchRows = protocols.filter((p) => watch.has(p.slug));
  const earlyAll = protocols.filter((p) => isPreToken(p) && !watch.has(p.slug) && p.tvl_usd < snap.floor_usd);
  const earlyKept: Protocol[] = [];
  const earlyExcluded: ExcludedRow[] = [];
  for (const p of earlyAll) {
    const reason = exclusionReason(p);
    if (reason) earlyExcluded.push({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, reason });
    else earlyKept.push(p);
  }
  // Above the floor but left out of the watchlist: show them too, with reasons.
  const aboveFloorLeftOut: ExcludedRow[] = [];
  for (const p of protocols.filter((x) => isPreToken(x) && !watch.has(x.slug) && x.tvl_usd >= snap.floor_usd)) {
    aboveFloorLeftOut.push({
      slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd,
      reason: exclusionReason(p) ?? "parent protocol recorded by DefiLlama (not one of the snapshot fields)",
    });
  }
  const candidates = [...watchRows, ...earlyKept];

  // §1 exponent test: Spearman vs pure TVL, top-10 overlap, over the board set.
  const exponentTests: { e: number; rho: number; top10Overlap: number; top10MinTvl: number }[] = [];
  const testEs = [0.7, 0.75, 0.8, 0.85, 0.9, b];
  for (const e of testEs) {
    const scored = candidates.map((p) => ({ p, imp: impliedAt(p, e, factors(p), multipleOf(p).multiple) }));
    scored.sort((x, y) => y.imp - x.imp);
    const top = scored.slice(0, 10);
    const tvlTop = new Set([...scored].sort((x, y) => y.p.tvl_usd - x.p.tvl_usd).slice(0, 10).map((r) => r.p.slug));
    exponentTests.push({
      e,
      rho: spearman(scored.map((r) => r.p.tvl_usd), scored.map((r) => r.imp)),
      top10Overlap: top.filter((r) => tvlTop.has(r.p.slug)).length,
      top10MinTvl: Math.min(...top.map((r) => r.p.tvl_usd)),
    });
  }
  // Pick: fitted b if it meets both targets, else the nearest tested e that does.
  const meets = (t: { rho: number; top10MinTvl: number }): boolean => t.rho >= 0.7 && t.rho <= 0.85 && t.top10MinTvl >= 200_000_000;
  const fittedTest = exponentTests[exponentTests.length - 1]!;
  let exponent = b;
  if (!meets(fittedTest)) {
    const passing = exponentTests.slice(0, 5).filter(meets);
    passing.sort((x, y) => Math.abs(x.e - b) - Math.abs(y.e - b));
    exponent = passing.length > 0 ? passing[0]!.e : 0.7;
  }

  // Rank the board at the chosen exponent, plus the category-neutral rank.
  const scored = candidates.map((p) => {
    const f = factors(p);
    const imp = impliedAt(p, exponent, f, f.catMultiple);
    const neutral = impliedAt(p, exponent, f, globalMultiple);
    return { p, f, imp, neutral };
  });
  scored.sort((x, y) => y.imp - x.imp || x.p.slug.localeCompare(y.p.slug));
  const neutralOrder = [...scored].sort((x, y) => y.neutral - x.neutral || x.p.slug.localeCompare(y.p.slug));
  const neutralRank = new Map<string, number>();
  neutralOrder.forEach((r, i) => neutralRank.set(r.p.slug, i + 1));

  const board: BoardRow[] = scored.map((r, i) => {
    const steps = farmSteps(r.p, r.f);
    const capital = capitalTier(r.p.tvl_usd);
    const hold = holdDays(r.f.ageYears);
    return {
      slug: r.p.slug,
      name: r.p.name,
      rank: i + 1,
      implied_value_usd: Math.max(1, Math.round(r.imp)),
      farm_steps: steps,
      category: r.p.category,
      tvl_usd: r.p.tvl_usd,
      change_7d: r.p.change_7d,
      chains: r.p.chains,
      age_years: r.f.ageYears,
      age_unknown: r.f.ageUnknown,
      m_cat: round4(r.f.catMultiple),
      cat_comps: r.f.catComps,
      cat_local: round4(r.f.catLocal),
      growth: round4(r.f.growth),
      f_age: round4(r.f.fAge),
      health: round4(r.f.health),
      maturity: round4(r.f.maturity),
      chain_factor: round4(r.f.chainFactor),
      nontvl: round4(r.f.nonTvl),
      capped: r.f.cappedLow ? "floor 0.65" : r.f.cappedHigh ? "cap 1.45" : "none",
      neutral_rank: neutralRank.get(r.p.slug)!,
      capital_usd: capital,
      hold_days: hold,
      attention: (r.p.change_7d ?? 0) <= -15,
      watch_out: watchOut(r.p, r.f),
    };
  });

  // Live-token separation: top 24 by market cap, never mixed into the board.
  const live: LiveRow[] = protocols
    .filter((p) => p.mcap_usd !== null)
    .sort((x, y) => y.mcap_usd! - x.mcap_usd!)
    .slice(0, 24)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd!, ratio: p.mcap_usd! / p.tvl_usd }));

  // Restricted: symbol but no gecko_id (258). The 14 with a gecko_id + symbol but
  // no market cap are listed separately: token recorded, value unmeasurable here.
  const restricted: RestrictedRow[] = protocols
    .filter((p) => p.symbol !== null && p.gecko_id === null)
    .sort((x, y) => y.tvl_usd - x.tvl_usd)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, tag: "symbol recorded, gecko_id missing" }));
  const restrictedExtra: RestrictedRow[] = protocols
    .filter((p) => p.gecko_id !== null && p.symbol !== null && p.mcap_usd === null)
    .sort((x, y) => y.tvl_usd - x.tvl_usd)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, tag: "token recorded, no market cap in snapshot" }));

  // Category summary over the board.
  const catRows = new Map<string, BoardRow[]>();
  for (const row of board) {
    const key = row.category ?? "(none)";
    const arr = catRows.get(key) ?? [];
    arr.push(row);
    catRows.set(key, arr);
  }
  const categories: CategorySummary[] = [...catRows.entries()]
    .map(([category, rows]) => {
      const info = catInfo.get(category) ?? { multiple: globalMultiple, comps: 0, local: globalMultiple };
      return {
        category,
        boardCount: rows.length,
        comps: info.comps,
        localMedian: round4(info.local),
        multiple: round4(info.multiple),
        medianImplied: Math.round(median(rows.map((r) => r.implied_value_usd))),
      };
    })
    .sort((x, y) => y.medianImplied - x.medianImplied);

  return {
    board, live, restricted, restrictedExtra,
    excluded: [...earlyExcluded, ...aboveFloorLeftOut].sort((x, y) => y.tvl_usd - x.tvl_usd),
    categories,
    fit: { n, a: round4(a), b: round4(b), se: round4(se), r2: round4(r2), tercileB: round4(tercileB) },
    exponent,
    exponentTests,
    globalMultiple: round4(globalMultiple),
    medianAgeYears: round4(medianAgeYears),
    counts: {
      protocols: protocols.length,
      watchlist: watchRows.length,
      earlyKept: earlyKept.length,
      earlyExcluded: earlyExcluded.length,
      aboveFloorLeftOut: aboveFloorLeftOut.length,
    },
  };
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

function capitalTier(tvl: number): number {
  if (tvl < 10_000_000) return 50;
  if (tvl < 50_000_000) return 100;
  if (tvl < 250_000_000) return 150;
  return 250;
}

function holdDays(ageYears: number | null): number {
  if (ageYears === null) return 45;
  if (ageYears < 1) return 30;
  if (ageYears <= 2) return 45;
  return 60;
}

function gasNote(p: Protocol): string {
  const l2 = p.chains.some((c) => L2_CHAINS.has(c));
  return l2
    ? "most steps run on a low-fee chain, so budget $1–$3 of gas per transaction"
    : "steps run on a main chain, so budget $5–$15 of gas per transaction";
}

function watchOut(p: Protocol, f: RowFactors): string {
  const change = p.change_7d ?? 0;
  if (change <= -15) return `TVL fell ${Math.abs(change).toFixed(1)}% in 7 days — farm small, re-check weekly.`;
  if (change >= 20) return `TVL jumped ${change.toFixed(1)}% in 7 days — check it is not a one-week incentive spike before sizing up.`;
  if (f.ageUnknown) return "Listed date is not in the snapshot — age is imputed at the watchlist median, so treat the maturity factor as approximate.";
  if (f.ageYears !== null && f.ageYears < 0.25) return `Listed ${Math.round(f.ageYears * 365)} days ago — early, higher uncertainty; keep the position small.`;
  return "No red flag in the snapshot — re-check TVL weekly; a launch, if any, is unannounced.";
}

function categoryAction(p: Protocol, capital: number): string {
  const cat = (p.category ?? "").toLowerCase();
  const chain = p.chains[0] ?? "its main chain";
  if (cat.includes("curator") || cat.includes("allocator") || cat.includes("vault")) {
    return `Deposit $${capital} into a ${p.category} vault on ${chain} through the protocol's own page, keeping the receipt transaction hash.`;
  }
  if (cat.includes("rwa")) {
    return `Put $${capital} into a tokenised real-world-asset position on ${chain} through the protocol's own page, and note the asset's redemption terms.`;
  }
  if (cat.includes("lend")) {
    return `Supply $${capital} of collateral on ${chain} through the protocol's own page, borrow nothing on the first pass, and note the supplied asset's rate.`;
  }
  if (cat.includes("dex")) {
    return `Provide $${capital} of liquidity in the protocol's largest pool on ${chain} through its own page, and note the pool's fee tier.`;
  }
  if (cat.includes("yield") || cat.includes("restak") || cat.includes("staking")) {
    return `Stake or deposit $${capital} through the protocol's own page on ${chain}, and note the lock-up or unstaking delay before you commit.`;
  }
  if (cat.includes("stable") || cat.includes("cdp")) {
    return `Mint or hold $${capital} of the protocol's stable asset on ${chain} through its own page, and note the collateral ratio it requires.`;
  }
  return `Use the protocol on ${chain} with $${capital} through its own page, in the way its ${p.category ?? "main"} product is designed to be used, and keep the transaction hash.`;
}

function farmSteps(p: Protocol, f: RowFactors): string[] {
  const capital = capitalTier(p.tvl_usd);
  const hold = holdDays(f.ageYears);
  const chain = p.chains[0] ?? "its main chain";
  const extra = p.chains.length > 1 ? p.chains[1]! : chain;
  const changeText = p.change_7d === null ? "not reported" : `${p.change_7d >= 0 ? "+" : ""}${p.change_7d.toFixed(2)}%`;
  return [
    `Open ${p.name} on ${chain} and connect a fresh wallet you use only for farming; never reuse your main wallet here. Cost: $0 to connect. Time: 10 minutes.`,
    `${categoryAction(p, capital)} Cost: $${capital} of capital plus gas. Time: 20 minutes.`,
    `Hold the position for ${hold} days without withdrawing, so the activity reads as a real user rather than a one-day visit. Cost: $0 while holding. Time: ${hold} days of waiting.`,
    `Do a second on-chain action on ${extra} — a deposit, a swap or a vote if the page offers one — so the wallet shows repeat use. Cost: gas only, ${gasNote(p)}. Time: 15 minutes.`,
    `Check the protocol's own page for a points or rewards programme; if one exists, follow its stated steps, and if none is shown, do not assume one exists. Cost: $0 to check. Time: 10 minutes.`,
    `Watch out: ${watchOut(p, f)} TVL is $${(p.tvl_usd / 1_000_000).toFixed(1)}M and the 7-day change is ${changeText}. Cost: $0 to re-check. Time: 10 minutes a week.`,
  ];
}

// --- data.js payload for the dashboard -----------------------------------

export function dataScript(result: RadarResult, snap: Snapshot): string {
  const payload = {
    meta: {
      asOf: snap.as_of,
      source: snap.source,
      floorUsd: snap.floor_usd,
      protocols: result.counts.protocols,
      watchlist: result.counts.watchlist,
      boardRows: result.board.length,
      model: "radar-2",
      exponent: result.exponent,
      fit: result.fit,
      exponentTests: result.exponentTests,
      globalMultiple: result.globalMultiple,
      medianAgeYears: result.medianAgeYears,
      rescaleRef: RESCALE_REF,
      rescaleConstant: Math.round(Math.pow(RESCALE_REF, 1 - result.exponent) * 10) / 10,
    },
    board: result.board,
    live: result.live,
    restricted: result.restricted,
    restrictedExtra: result.restrictedExtra,
    excluded: result.excluded,
    categories: result.categories,
  };
  return `window.RADAR = ${JSON.stringify(payload)};\n`;
}

// --- gate self-check (the seven rows, in the entry's own words) ----------

export function boardIssue(board: BoardRow[], snap: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, outside 100–4000`;
  const slugs = new Set(snap.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  let prev = Infinity;
  for (let i = 0; i < board.length; i++) {
    const r = board[i]!;
    if (!slugs.has(r.slug)) return `row ${i + 1} names ${r.slug}, not in the snapshot`;
    if (seen.has(r.slug)) return `slug ${r.slug} appears twice`;
    seen.add(r.slug);
    if (!r.name) return `row ${i + 1} has an empty name`;
    if (r.rank !== i + 1) return `row ${i + 1} carries rank ${r.rank}`;
    if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) {
      return `row ${r.slug} has an implied value that is not a positive whole number under 10^14`;
    }
    if (r.implied_value_usd > prev) return `implied value rises at rank ${r.rank}`;
    prev = r.implied_value_usd;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `row ${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim().length;
      if (t < 20 || t > 600) return `row ${r.slug} has a farm step of ${t} characters`;
    }
  }
  if (new Set(board.map((r) => r.implied_value_usd)).size === 1 && board.length > 1) return "every implied value is the same";
  for (const slug of snap.watchlist) {
    if (!seen.has(slug)) return `watchlist slug ${slug} is missing from the board`;
  }
  return null;
}

export { money };
