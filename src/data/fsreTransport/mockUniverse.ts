/**
 * The mock's synthetic universe: fictitious tickers only (hard constraint 4),
 * five chain groups plus spanning layers, with the deliberate blocks the
 * brief requires: one excluded ticker (MOCKX), one missing archetype, one
 * single-company sub-industry. Also the industry-progress board's baseline
 * rows.
 */
import type { IndustryProgressRow } from './contract';
import { CHAIN_GROUPS } from '../../logic/lab/fsre/statuses';
import { STAGES_TOTAL } from './provisional';

export interface UniverseCompany {
  ticker: string;
  name: string;
  subIndustryCode: string;
}

export interface UniverseSubIndustry {
  code: string;
  name: string;
  chainGroup: (typeof CHAIN_GROUPS)[number];
  chainOrder: number | null;
  archetype: { id: string | null; status: 'available' | 'missing' };
  companies: UniverseCompany[];
  /** Set for the sub-industry holding the excluded ticker. */
  excluded?: { ticker: string; reason: string };
}

export const SYNTHETIC_START_ISO = '2026-10-06T09:00:00.000Z';

export const SUB_INDUSTRIES: UniverseSubIndustry[] = [
  {
    code: 'SYN-COA',
    name: 'Synthetic coal mining',
    chainGroup: 'Raw-material extraction',
    chainOrder: 1,
    archetype: { id: 'ARC-ASSET', status: 'available' },
    companies: [
      { ticker: 'MOCKX', name: 'Mockex Coal Syntara', subIndustryCode: 'SYN-COA' },
      { ticker: 'SYNJ', name: 'Synjaya Coal Nusantara', subIndustryCode: 'SYN-COA' },
    ],
    excluded: { ticker: 'MOCKX', reason: 'On the conflict list' },
  },
  {
    code: 'SYN-CEM',
    name: 'Synthetic cement',
    chainGroup: 'Basic industry',
    chainOrder: 2,
    archetype: { id: 'ARC-PROC', status: 'available' },
    companies: [
      { ticker: 'SYNA', name: 'Syncement Nusantara', subIndustryCode: 'SYN-CEM' },
      { ticker: 'SYNB', name: 'Syncement Harmoni', subIndustryCode: 'SYN-CEM' },
    ],
  },
  {
    code: 'SYN-STL',
    name: 'Synthetic steel',
    chainGroup: 'Basic industry',
    chainOrder: 3,
    archetype: { id: 'ARC-ASSET', status: 'available' },
    companies: [
      { ticker: 'SYNC', name: 'Synpurg Baja Utama', subIndustryCode: 'SYN-STL' },
      { ticker: 'SYND', name: 'Syndika Steel Raya', subIndustryCode: 'SYN-STL' },
    ],
  },
  {
    code: 'SYN-PAP',
    name: 'Synthetic paper',
    chainGroup: 'Processing industry',
    chainOrder: 4,
    archetype: { id: 'ARC-PROC', status: 'available' },
    companies: [
      { ticker: 'SYNL', name: 'Synleaf Paper Andalan', subIndustryCode: 'SYN-PAP' },
      { ticker: 'SYNM', name: 'Synmira Pulp Lestari', subIndustryCode: 'SYN-PAP' },
    ],
  },
  {
    code: 'SYN-DIS',
    name: 'Synthetic distribution',
    chainGroup: 'Distribution',
    chainOrder: 5,
    archetype: { id: 'ARC-DIST', status: 'available' },
    companies: [
      { ticker: 'SYNN', name: 'Synnia Distribution Pratama', subIndustryCode: 'SYN-DIS' },
      { ticker: 'SYNO', name: 'Synova Logistik Niaga', subIndustryCode: 'SYN-DIS' },
    ],
  },
  {
    code: 'SYN-PHA',
    name: 'Synthetic retail pharmacies',
    chainGroup: 'Sales channels',
    chainOrder: 6,
    archetype: { id: null, status: 'missing' },
    companies: [
      { ticker: 'SYNE', name: 'Synerva Pharma Retail', subIndustryCode: 'SYN-PHA' },
      { ticker: 'SYNF', name: 'Synfarma Sejahtera', subIndustryCode: 'SYN-PHA' },
    ],
  },
  {
    code: 'SYN-RET',
    name: 'Synthetic grocery retail',
    chainGroup: 'Sales channels',
    chainOrder: 7,
    archetype: { id: 'ARC-DIST', status: 'available' },
    companies: [
      { ticker: 'SYNP', name: 'Synprima Ritel Pangan', subIndustryCode: 'SYN-RET' },
      { ticker: 'SYNQ', name: 'Synquez Mart Nusantara', subIndustryCode: 'SYN-RET' },
    ],
  },
  {
    code: 'SYN-PWR',
    name: 'Synthetic power plants',
    chainGroup: 'Spanning layers — Energy',
    chainOrder: 8,
    archetype: { id: 'ARC-ASSET', status: 'available' },
    companies: [{ ticker: 'SYNI', name: 'Synindo Power Listrik', subIndustryCode: 'SYN-PWR' }],
  },
  {
    code: 'SYN-LOG',
    name: 'Synthetic logistics',
    chainGroup: 'Spanning layers — Logistics',
    chainOrder: 9,
    archetype: { id: 'ARC-DIST', status: 'available' },
    companies: [
      { ticker: 'SYNG', name: 'Syngarga Kirim Umum', subIndustryCode: 'SYN-LOG' },
      { ticker: 'SYNH', name: 'Synhaul Pelabuhan Jaya', subIndustryCode: 'SYN-LOG' },
    ],
  },
];

/** The ticker the brief requires to be on the conflict list. */
export const EXCLUDED_TICKER = 'MOCKX';
export const EXCLUDED_REASON = 'On the conflict list';

export function companyByTicker(ticker: string): UniverseCompany | null {
  for (const sub of SUB_INDUSTRIES) {
    const hit = sub.companies.find((c) => c.ticker === ticker.toUpperCase());
    if (hit) return hit;
  }
  return null;
}

export function subIndustryByCode(code: string): UniverseSubIndustry | null {
  return SUB_INDUSTRIES.find((s) => s.code === code) ?? null;
}

/**
 * Match free text (a ticker or a company-name fragment) to a sub-industry.
 * Exact tickers win, then exact sub-industry code or name, then substrings.
 */
export function matchSubIndustry(text: string): UniverseSubIndustry | null {
  const q = text.trim().toLowerCase();
  if (!q) return null;
  for (const sub of SUB_INDUSTRIES) {
    const hit = sub.companies.find((c) => c.ticker.toLowerCase() === q);
    if (hit) return sub;
  }
  for (const sub of SUB_INDUSTRIES) {
    if (sub.code.toLowerCase() === q || sub.name.toLowerCase() === q) return sub;
  }
  for (const sub of SUB_INDUSTRIES) {
    if (sub.companies.some((c) => c.name.toLowerCase().includes(q))) return sub;
  }
  for (const sub of SUB_INDUSTRIES) {
    if (sub.name.toLowerCase().includes(q)) return sub;
  }
  return null;
}

/* ---------- industry progress baseline ---------- */

interface SeedCompany {
  ticker: string;
  stageIndex: number;
  g1?: 'pending' | 'passed' | 'failed' | 'passed_with_open_escalations';
  g2?: 'pending' | 'passed' | 'failed' | 'passed_with_open_escalations';
  g3?: 'pending' | 'passed' | 'failed' | 'passed_with_open_escalations';
  escalationsOpen?: number;
  publishedVersion?: string;
  engagementId?: string;
}

interface SeedRow {
  code: string;
  companies: SeedCompany[];
  chainOrder?: number | null;
}

/**
 * 14 rows, mixed states: one covered (both published), two mid-pipeline,
 * two not placed on the chain, the rest not started. The synthetic cement
 * row starts not-started and fills as the scripted run progresses.
 */
const SEEDS: SeedRow[] = [
  { code: 'SYN-PAP', companies: [
    { ticker: 'SYNL', stageIndex: 13, g1: 'passed', g2: 'passed', g3: 'passed', publishedVersion: 'v1.2', engagementId: 'eng-pap-1' },
    { ticker: 'SYNM', stageIndex: 13, g1: 'passed', g2: 'passed', g3: 'passed', publishedVersion: 'v1.1', engagementId: 'eng-pap-1' },
  ] },
  { code: 'SYN-RET', companies: [
    { ticker: 'SYNP', stageIndex: 13, g1: 'passed', g2: 'passed', g3: 'passed', publishedVersion: 'v2.0', engagementId: 'eng-ret-2' },
    { ticker: 'SYNQ', stageIndex: 13, g1: 'passed', g2: 'passed', g3: 'passed', publishedVersion: 'v2.0', engagementId: 'eng-ret-2' },
  ] },
  { code: 'SYN-STL', companies: [
    { ticker: 'SYNC', stageIndex: 9, g1: 'passed', g2: 'pending', engagementId: 'eng-stl-1' },
    { ticker: 'SYND', stageIndex: 7, g1: 'passed', engagementId: 'eng-stl-1' },
  ] },
  { code: 'SYN-LOG', companies: [
    { ticker: 'SYNG', stageIndex: 10, g1: 'passed', g2: 'passed_with_open_escalations', escalationsOpen: 1, engagementId: 'eng-log-1' },
    { ticker: 'SYNH', stageIndex: 10, g1: 'passed', g2: 'passed', engagementId: 'eng-log-1' },
  ] },
  { code: 'SYN-DIS', companies: [
    { ticker: 'SYNN', stageIndex: 4, engagementId: 'eng-dis-1' },
    { ticker: 'SYNO', stageIndex: 2, engagementId: 'eng-dis-1' },
  ] },
  { code: 'SYN-COA', companies: [] },
  { code: 'SYN-CEM', companies: [] },
  { code: 'SYN-PHA', companies: [] },
  { code: 'SYN-PWR', companies: [] },
  // not placed on the chain yet
  { code: 'SYN-PLT', companies: [{ ticker: 'SYNR', stageIndex: 13, g1: 'passed', g2: 'passed', g3: 'passed', publishedVersion: 'v0.9', engagementId: 'eng-plt-1' }, { ticker: 'SYNS', stageIndex: 5, g1: 'passed', engagementId: 'eng-plt-1' }] },
  { code: 'SYN-PRP', companies: [] },
  { code: 'SYN-AUT', companies: [] },
  { code: 'SYN-TEL', companies: [] },
  { code: 'SYN-INS', companies: [] },
];

const EXTRA_SUBS: Record<string, { name: string; chainGroup: (typeof CHAIN_GROUPS)[number] }> = {
  'SYN-PLT': { name: 'Synthetic plantations', chainGroup: 'Raw-material extraction' },
  'SYN-PRP': { name: 'Synthetic property', chainGroup: 'End users' },
  'SYN-AUT': { name: 'Synthetic auto parts', chainGroup: 'Processing industry' },
  'SYN-TEL': { name: 'Synthetic telecom carriers', chainGroup: 'Spanning layers — Logistics' },
  'SYN-INS': { name: 'Synthetic life insurers', chainGroup: 'End users' },
};

export function baseIndustryProgress(): IndustryProgressRow[] {
  return SEEDS.map((seed) => {
    const known = subIndustryByCode(seed.code);
    const extra = EXTRA_SUBS[seed.code];
    const chainGroup = known?.chainGroup ?? extra?.chainGroup ?? 'Not placed on the chain yet';
    const name = known?.name ?? extra?.name ?? seed.code;
    // sub-industries not in the intake universe (extras) are not placed yet
    const chainOrder = known ? known.chainOrder : null;
    const target = known && known.companies.length < 2 ? 2 : 2;
    const companies = seed.companies.map((c) => ({
      ticker: c.ticker,
      engagementId: c.engagementId ?? '',
      stageIndex: c.stageIndex,
      stagesTotal: STAGES_TOTAL,
      gates: { g1: c.g1 ?? 'pending', g2: c.g2 ?? 'pending', g3: c.g3 ?? 'pending' } as IndustryProgressRow['companies'][number]['gates'],
      escalationsOpen: c.escalationsOpen ?? 0,
      publishedVersion: c.publishedVersion ?? null,
    }));
    const covered = companies.filter((c) => c.publishedVersion !== null).length >= 2;
    return {
      subIndustryCode: seed.code,
      subIndustryName: name,
      chainGroup,
      chainOrder,
      targetCompanies: target,
      companies,
      covered,
    } satisfies IndustryProgressRow;
  });
}

/** A synthetic filing set for the plan card; doc ids are fictitious. */
export function syntheticFilings(ticker: string): { docId: string; period: string; kind: string }[] {
  const t = ticker.toUpperCase();
  return [
    { docId: `${t}-FY2025-A`, period: 'FY2025', kind: 'Annual report' },
    { docId: `${t}-FY2024-A`, period: 'FY2024', kind: 'Annual report' },
    { docId: `${t}-HY2025-I`, period: 'HY2025', kind: 'Interim report' },
  ];
}
