// Token Radar's launch-readiness model, version launch-1: how ready a pre-token protocol looks to
// launch a token, from the same snapshot figures the implied-value model uses.
//
// Readiness is not a prediction that a token will launch, or when: it is a 0-100 score of how the
// protocol's record reads on the five things that have to be true before a launch is worth doing.
// Momentum says the protocol is growing now; scale says there is enough value to share; maturity
// says it has run long enough with no token that one would land on a real user base; breadth says
// it reaches more than one chain; category says tokens in that line of business have launched
// before. Each part is a 0-100 score of its own figure, and the readiness is their weighted mean:
//
//   readiness = round(0.25 x momentum + 0.25 x scale + 0.20 x maturity + 0.10 x breadth + 0.20 x category)
//
// The weights are the model's own claim: growth and size matter most, age and category next, chain
// count least, because a launch is a decision about a live business, not a count of deployments.
// The reason string names the two parts that contributed most, so a reader can see at a glance
// whether a high score is growth, size, age, reach or category. The launch candidates are the
// board's top 25 by readiness times the log of implied value: the protocols where a launch would
// be both ready and worth the most.

import { ageDays, type BoardRow, type LaunchCandidate, type SnapshotProtocol } from './model.ts';

/** This module's version label: the dashboard names it beside the implied-value model. */
export const LAUNCH_VERSION = 'launch-1';

/** How much each part of the record weighs in the readiness score; they sum to one. */
export const LAUNCH_WEIGHTS = { momentum: 0.25, scale: 0.25, maturity: 0.2, breadth: 0.1, category: 0.2 };

/** The smallest TVL the snapshot carries ($5M) and the TVL a launch is capped at ($10B), for the scale part. */
const SCALE_FLOOR_LOG = Math.log10(5_000_000);
const SCALE_CAP_LOG = Math.log10(10_000_000_000);

/** The age, in days, that counts as fully mature: three years with no token. */
const MATURITY_DAYS = 1095;

/** The age used when the snapshot records none: one year, the model's own unknown-age figure. */
const UNKNOWN_AGE_DAYS = 365;

/** The most chains that count toward breadth: a protocol on six chains is as broad as it gets. */
const BREADTH_CHAINS = 6;

/** How many launch candidates the board names. */
export const LAUNCH_CANDIDATES = 25;

/**
 * How often tokens have launched in a category, 0-100: fee-capturing businesses launch most, because
 * a token there captures the protocol's own fees; curator and service businesses launch least, because
 * a token there is governance only. A category the table does not name scores in the middle.
 */
const CATEGORY_LAUNCH: Record<string, number> = {
  Dexs: 85,
  Lending: 85,
  Derivatives: 80,
  Perpetuals: 80,
  'Yield Aggregator': 75,
  Yield: 72,
  'Leveraged Farming': 70,
  CDP: 70,
  'Prediction Market': 70,
  'Basis Trading': 65,
  Stablecoins: 60,
  Options: 60,
  'Cross Chain': 55,
  Chain: 55,
  Farm: 55,
  'Onchain Capital Allocator': 40,
  'Risk Curators': 40,
  RWA: 45,
  Insurance: 35,
};

/** The launch propensity of a category: the table's value, or a substring match, or the middle. */
export function categoryLaunch(category: string | null): number {
  if (category === null) return 55;
  const exact = CATEGORY_LAUNCH[category];
  if (exact !== undefined) return exact;
  const c = category.toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 85;
  if (c.includes('dex') || c.includes('leveraged farm')) return 80;
  if (c.includes('perpetual') || c.includes('derivative')) return 80;
  if (c.includes('yield') || c.includes('aggregator')) return 72;
  if (c.includes('prediction')) return 70;
  if (c.includes('basis')) return 65;
  if (c.includes('stable')) return 60;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return 40;
  if (c.includes('rwa')) return 45;
  if (c.includes('insurance')) return 35;
  if (c.includes('farm')) return 55;
  return 55;
}

/** A number clamped to the 0-100 range a part scores on. */
function partScore(n: number): number {
  return Math.min(100, Math.max(0, n));
}

/** One protocol's five readiness parts, each 0-100, from the snapshot's own figures. */
export interface ReadinessParts {
  momentum: number;
  scale: number;
  maturity: number;
  breadth: number;
  category: number;
  age: number | null;
}

/** One protocol's five readiness parts, each 0-100, from the snapshot's own figures. */
export function readinessParts(protocol: SnapshotProtocol, asOf: string): ReadinessParts {
  const change = typeof protocol.change_7d === 'number' && Number.isFinite(protocol.change_7d) ? protocol.change_7d : 0;
  const clamped = Math.min(150, Math.max(-60, change));
  const momentum = partScore(((clamped + 60) / 210) * 100);
  const tvlLog = Math.log10(Math.max(protocol.tvl_usd, 1));
  const scale = partScore(((tvlLog - SCALE_FLOOR_LOG) / (SCALE_CAP_LOG - SCALE_FLOOR_LOG)) * 100);
  const age = ageDays(asOf, protocol.listed_at);
  const ageForScore = age ?? UNKNOWN_AGE_DAYS;
  const maturity = partScore((Math.min(Math.max(ageForScore, 0), MATURITY_DAYS) / MATURITY_DAYS) * 100);
  const breadth = partScore((Math.min(protocol.chains.length, BREADTH_CHAINS) / BREADTH_CHAINS) * 100);
  const category = categoryLaunch(protocol.category);
  return { momentum, scale, maturity, breadth, category, age };
}

/** A whole-dollar amount as a short string: $520.7M, $2.8B, $45.2K. */
function fmtUsdShort(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}

/** The five parts' names, in the order the reason string ranks them by contribution. */
type ReadinessPart = 'momentum' | 'scale' | 'maturity' | 'breadth' | 'category';

/**
 * One part's contribution to the reason string: the part's name and the figure behind it, in the
 * words a reader checks. A part that scored low still names itself when it contributed most,
 * because a low part can still be the largest share of a low score.
 */
function reasonFor(part: ReadinessPart, protocol: SnapshotProtocol, parts: ReadinessParts): string {
  if (part === 'momentum') {
    if (protocol.change_7d === null) return 'no 7d change reported';
    const sign = protocol.change_7d >= 0 ? '+' : '';
    return `momentum ${sign}${protocol.change_7d.toFixed(1)}% 7d`;
  }
  if (part === 'scale') return `TVL ${fmtUsdShort(protocol.tvl_usd)}`;
  if (part === 'maturity') {
    if (parts.age === null) return 'age unknown, a year assumed';
    if (parts.age >= 365) return `live ${(parts.age / 365).toFixed(1)}y with no token`;
    return `live ${parts.age}d with no token`;
  }
  if (part === 'breadth') {
    const n = protocol.chains.length;
    return n <= 1 ? 'on one chain' : `on ${n} chains`;
  }
  const cat = protocol.category ?? 'an unnamed category';
  if (parts.category >= 70) return `${cat} launches often`;
  if (parts.category >= 50) return `${cat} launches sometimes`;
  return `${cat} rarely launches`;
}

/** One protocol's launch readiness, 0-100, with its five parts and the two that contributed most. */
export function scoreReadiness(
  protocol: SnapshotProtocol,
  asOf: string,
): { readiness: number; reason: string; parts: ReadinessParts } {
  const parts = readinessParts(protocol, asOf);
  const w = LAUNCH_WEIGHTS;
  const readiness = Math.round(
    w.momentum * parts.momentum + w.scale * parts.scale + w.maturity * parts.maturity + w.breadth * parts.breadth + w.category * parts.category,
  );
  const contributions: Array<{ part: ReadinessPart; value: number }> = [
    { part: 'momentum', value: w.momentum * parts.momentum },
    { part: 'scale', value: w.scale * parts.scale },
    { part: 'maturity', value: w.maturity * parts.maturity },
    { part: 'breadth', value: w.breadth * parts.breadth },
    { part: 'category', value: w.category * parts.category },
  ];
  contributions.sort((a, b) => b.value - a.value || (a.part < b.part ? -1 : 1));
  const top = contributions.slice(0, 2).map((c) => reasonFor(c.part, protocol, parts));
  return { readiness: Math.min(100, Math.max(0, readiness)), reason: top.join(' · '), parts };
}

/** A launch candidate: a board row's place in the top 25 by readiness times log implied value. */
export function launchCandidates(board: BoardRow[]): LaunchCandidate[] {
  const scored = board
    .filter((r) => r.launch_readiness !== undefined)
    .map((r) => ({
      slug: r.slug,
      name: r.name,
      readiness: r.launch_readiness!,
      implied_value_usd: r.implied_value_usd,
      combined: Math.round(r.launch_readiness! * Math.log10(r.implied_value_usd + 1) * 10) / 10,
    }));
  scored.sort((a, b) => b.combined - a.combined || b.readiness - a.readiness || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  return scored.slice(0, LAUNCH_CANDIDATES).map((s, i) => ({ rank: i + 1, ...s }));
}
