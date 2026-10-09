// Copied from dikagustiana/dikagustiana.com@bed215d8046986843dcb30b4e88d0977f834f90d src/data/capitalConditions.ts. Do not edit here; re-copy.
/**
 * Capital Allocation Framework — Data layer.
 * 21 conditions across 6 structural layers.
 */

export interface HypotheticalModelRow {
  metric: string;
  whatHappened: string;
  whatShouldHaveHappened: string;
}

export interface CapitalCondition {
  id: string;
  number: number;
  title: string;
  caseCompany: string;
  tension: string;
  quantitative: string;
  rule: string;
  hypotheticalModel?: HypotheticalModelRow[];
  layer: 'operational' | 'balance-sheet' | 'portfolio' | 'transition' | 'valuation' | 'structural-transformation';
}

export interface CapitalLayer {
  key: CapitalCondition['layer'];
  number: string;
  label: string;
  narrative: string;
}

export const LAYERS: CapitalLayer[] = [
  {
    key: 'operational',
    number: 'I',
    label: 'Operational',
    narrative: 'Most capital mistakes begin before the investment committee meets. Operational conditions determine whether a business is structurally ready to receive capital — or whether additional capital simply accelerates the underlying problem.',
  },
  {
    key: 'balance-sheet',
    number: 'II',
    label: 'Balance Sheet',
    narrative: 'The balance sheet does not lie, but it can mislead — especially when liability structure is misread as financial strength. What I learned early: the question is never whether the debt is manageable today, but whether it survives the scenario you haven\'t modeled yet.',
  },
  {
    key: 'portfolio',
    number: 'III',
    label: 'Portfolio',
    narrative: 'Capital allocation at the portfolio level is not diversification for its own sake — it is managing exposure to cycles, dependencies, and transition risk simultaneously. The businesses that survive regime shifts are rarely the ones with the best assets; they are the ones that moved capital before the window closed.',
  },
  {
    key: 'transition',
    number: 'IV',
    label: 'Transition',
    narrative: 'Indonesia\'s energy transition is not a policy story — it is a capital structure problem. The gap between transition ambition and deployment reality exists almost entirely at the structuring layer, not the political layer.',
  },
  {
    key: 'valuation',
    number: 'V',
    label: 'Valuation',
    narrative: 'Valuation is where structural discipline either holds or collapses. The most dangerous moment in any capital decision is when the model produces a number that feels right — before anyone has asked what assumptions are doing the work.',
  },
  {
    key: 'structural-transformation',
    number: 'VI',
    label: 'Structural Transformation',
    narrative: 'Most sovereign capital fails at the architecture layer, not the ambition layer. Having worked on the private capital side of Indonesian investment decisions, I understand what makes institutional money move — and what keeps it out regardless of incentive design.',
  },
];

export const LAYER_ORDER: { layer: CapitalCondition['layer']; conditionNumbers: number[] }[] = [
  { layer: 'operational', conditionNumbers: [1, 2, 7] },
  { layer: 'balance-sheet', conditionNumbers: [6, 11, 12] },
  { layer: 'portfolio', conditionNumbers: [3, 8, 14] },
  { layer: 'transition', conditionNumbers: [4, 5, 9, 10, 16, 17] },
  { layer: 'valuation', conditionNumbers: [13, 15, 18] },
  { layer: 'structural-transformation', conditionNumbers: [19, 20, 21] },
];

/**
 * Each case is a causal claim about a named company. Keep false until every
 * attribution has passed the Verification Register; the `caseCompany` data
 * below stays in place and is simply not rendered.
 */
export const SHOW_CASE_COMPANIES = false;

export const CONDITIONS: CapitalCondition[] = [
  {
    id: 'low-growth-idle', number: 1, layer: 'operational',
    title: 'Low Growth with Idle Capacity',
    caseCompany: 'Blue Bird',
    tension: 'Idle fleet capacity absorbing fixed costs while revenue growth stagnates. Expansion instinct persists despite underutilization.',
    quantitative: 'Utilization ↓ → Asset Turnover ↓ → ROIC ↓ → Capital destruction at scale',
    rule: 'Fix productivity before expanding assets.',
  },
  {
    id: 'aggressive-expansion', number: 2, layer: 'operational',
    title: 'Aggressive Expansion with Assumption Distortion',
    caseCompany: 'Garuda Indonesia',
    tension: 'Fleet expansion justified by optimistic demand and load factor assumptions. Fixed obligations locked in before assumptions were stress-tested.',
    quantitative: 'If projected utilization or yield misses by 10–15%, fixed lease obligations remain while EBITDA collapses. Interest coverage deteriorates faster than revenue recovery.',
    rule: 'Stress-test core assumptions before approving expansion.',
  },
  {
    id: 'commodity-windfall', number: 3, layer: 'portfolio',
    title: 'Commodity Windfall',
    caseCompany: 'Adaro Energy vs Bukit Asam',
    tension: 'Coal windfall creates illusion of permanent earnings. Reinvestment into same commodity deepens stranded asset exposure as transition accelerates.',
    quantitative: 'Windfall EBITDA margin 40–50% at cycle peak → Normalized margin 15–20% → Capex committed at peak overstates sustainable return → Stranded asset risk unpriced',
    rule: 'Redeploy windfall to reduce cyclicality and transition exposure. Price stranded asset risk before reinvestment.',
  },
  {
    id: 'long-gestation-capex', number: 4, layer: 'transition',
    title: 'Long-Gestation Capex-Heavy Assets',
    caseCompany: 'Pertamina Geothermal Energy',
    tension: 'Geothermal development requires 7–10 year gestation before cash flow. Commercial funding tenors mismatched. Concessional capital necessary to bridge viability gap.',
    quantitative: 'Development capex front-loaded → Revenue generation delayed 7–10 years → IRR sensitive to discount rate → Concessional funding reduces WACC by 200–300bps → Project viability restored',
    rule: 'Align funding duration with asset life. Structure concessional layer to absorb early-stage risk before commercial capital enters.',
  },
  {
    id: 'sovereign-risk', number: 5, layer: 'transition',
    title: 'Sovereign Risk Absorption',
    caseCompany: 'Indonesia Investment Authority',
    tension: 'Private capital reprices Indonesia sovereign risk above actual project fundamentals. First-loss sovereign layer necessary to unlock institutional capital at scale.',
    quantitative: 'Sovereign risk premium 150–250bps above project IRR → First-loss tranche covering 10–15% of capital stack → Private capital required return drops → Capital mobilization ratio 1:4 to 1:7',
    rule: 'Transition is achieved by repricing risk through sovereign first-loss capital. Separate sovereign credit from project credit in capital stack design.',
  },
  {
    id: 'overexpansion-debt', number: 6, layer: 'balance-sheet',
    title: 'Overexpansion Funded by Debt',
    caseCompany: 'Waskita Karya',
    tension: 'Infrastructure project pipeline funded aggressively through leverage. Receivable collection cycles mismatched against debt service schedules.',
    quantitative: 'Debt/EBITDA expansion → Interest coverage compression → Covenant breach risk → Equity dilution under restructuring',
    rule: 'Stress leverage under downside EBITDA before committing to project pipeline.',
  },
  {
    id: 'working-capital', number: 7, layer: 'operational',
    title: 'Working Capital Outpacing Revenue',
    caseCompany: 'Indofarma',
    tension: 'Inventory and receivables growing faster than revenue. Working capital cycle consuming cash before operations generate it.',
    quantitative: 'CCC elongation → Operating cash flow compression → Funding gap filled by short-term debt → Liquidity risk',
    rule: 'Cash conversion discipline before scaling.',
  },
  {
    id: 'portfolio-diversification', number: 8, layer: 'portfolio',
    title: 'Portfolio Diversification for Resilience',
    caseCompany: 'Astra International',
    tension: 'Legacy automotive and financial services dominance creates single-cycle dependency. EV transition creating structural disruption to core revenue streams while optionality in new segments remains underpriced.',
    quantitative: 'ICE revenue concentration → EV adoption curve compressing legacy margins → Transition optionality not reflected in current capital allocation weights',
    rule: 'Allocate across cycles, not within one dependency. Price EV transition optionality explicitly in portfolio construction.',
  },
  {
    id: 'strategic-downstreaming', number: 9, layer: 'transition',
    title: 'Strategic Downstreaming',
    caseCompany: 'Vale Indonesia',
    tension: 'Raw nickel export generates commodity-level returns. Downstream processing into battery-grade material captures transition premium. Capital required to move up value chain before global EV supply chain locks in alternative suppliers.',
    quantitative: 'Nickel ore margin 15–20% → Battery-grade nickel margin 35–45% → Processing capex significant but IRR justified by supply chain strategic premium → Optionality value of EV supply chain positioning not captured in base IRR',
    rule: 'Value optionality alongside IRR. Strategic positioning in critical mineral supply chain commands premium above discounted cash flow.',
  },
  {
    id: 'blended-finance', number: 10, layer: 'transition',
    title: 'Blended Finance for Transition',
    caseCompany: 'Asian Development Bank',
    tension: 'Transition infrastructure commercially unviable at market rates. Concessional and grant capital required to create investable structure. Capital stack sequencing determines whether private capital mobilizes or stays out.',
    quantitative: 'Grant/concessional layer 15–20% of stack → Reduces blended cost of capital by 150–200bps → Project crosses commercial viability threshold → Private capital mobilization ratio unlocked at 1:5 to 1:8',
    rule: 'Engineer the capital stack before approaching the market. Sequence grant → concessional → mezzanine → senior commercial → equity.',
  },
  {
    id: 'cost-of-capital-shift', number: 11, layer: 'balance-sheet',
    title: 'Cost of Capital Regime Shift',
    caseCompany: 'Lippo Karawaci',
    tension: 'Business model priced under low-rate assumptions. Rising rate environment reprices entire capital structure. Green/brown asset divergence accelerating ESG-linked cost of capital spread.',
    quantitative: 'WACC shift of 150–200bps → Project NPV compression → Hurdle rate breach on existing pipeline → Capital reallocation trigger',
    rule: 'Reprice hurdle rate dynamically as macro regime shifts. Apply brown discount to legacy asset valuations.',
  },
  {
    id: 'duration-mismatch', number: 12, layer: 'balance-sheet',
    title: 'Duration Mismatch',
    caseCompany: 'PLN',
    tension: 'Long-duration coal infrastructure funded through short and medium tenor instruments. JETP transition commitments creating stranded asset liability before debt maturity.',
    quantitative: 'Asset life 25–30 years → Funding tenor 5–10 years → Refinancing risk compounds as transition policy tightens → Stranded asset liability not yet on balance sheet',
    rule: 'Match tenor with asset life. Separate transition liability from operational debt structure.',
  },
  {
    id: 'optionality-efficiency', number: 13, layer: 'valuation',
    title: 'Optionality vs Efficiency',
    caseCompany: 'Medco Energi Internasional',
    tension: 'Undeveloped gas block portfolio creates efficiency drag on current ROIC. Market pressure to optimize producing assets conflicts with strategic value of holding undeveloped reserves as transition optionality.',
    quantitative: 'Undeveloped reserve carrying cost → Current ROIC drag 100–150bps → Gas optionality value unpriced in base DCF → Developed reserves command 20–30% price premium if transition accelerates',
    rule: 'Price optionality explicitly before optimizing for efficiency. Undeveloped reserves in a transition context are not idle capital — they are a structural hedge.',
  },
  {
    id: 'capital-recycling', number: 14, layer: 'portfolio',
    title: 'Capital Recycling Discipline',
    caseCompany: 'Saratoga Investama Sedaya',
    tension: 'Capital locked in mature brown assets while transition infrastructure offers higher marginal returns. Recycling discipline absent creates portfolio drag.',
    quantitative: 'IRR differential between mature legacy positions vs transition infrastructure 300–500bps → Opportunity cost of inaction compounds annually',
    rule: 'Move capital to highest marginal return. Establish systematic recycling trigger from brown to transition assets.',
  },
  {
    id: 'exit-multiple', number: 15, layer: 'valuation',
    title: 'Exit Multiple Dependency',
    caseCompany: 'GoTo',
    tension: 'Valuation built on exit multiple expansion rather than operational value creation. When multiple compression occurs, underlying business fundamentals insufficient to sustain capital structure.',
    quantitative: 'Revenue multiple at peak 15–20x → Compression to 3–5x → Equity value destruction not explained by operational deterioration → Exit multiple was doing the work, not EBITDA growth',
    rule: 'Separate operational value creation from multiple expansion in any valuation. Stress-test terminal value under multiple compression before capital commitment.',
  },
  {
    id: 'jetp-capital', number: 16, layer: 'transition',
    title: 'JETP Capital Architecture',
    caseCompany: 'Indonesia JETP $20B Commitment',
    tension: 'Concessional capital conditionality conflicts with sovereign policy autonomy. Grant, concessional loan, and guarantee instruments bundled without structural separation. Deployment risk high without architecture clarity.',
    quantitative: '$20B total commitment → Grant component less than 5% → Concessional loan 40–50% → Guarantees and market instruments remainder → Effective concessionality lower than headline suggests → Deployment bottleneck at structuring layer',
    rule: 'Separate grant, concessional loan, and guarantee tranches explicitly before deployment. Conditionality must be tied to measurable transition milestones, not policy compliance alone.',
  },
  {
    id: 'stranded-asset', number: 17, layer: 'transition',
    title: 'Stranded Asset Risk Pricing',
    caseCompany: 'PLN Coal Fleet Pre-Retirement',
    tension: 'Coal plants carrying book value significantly above economic value under accelerated transition scenarios. Incremental capex still allocated to legacy assets without pricing transition liability.',
    quantitative: 'Remaining book value of coal fleet → Economic value under 1.5°C scenario → Transition liability gap unprovisioned → Incremental capex earning return below transition-adjusted hurdle rate',
    rule: 'Price transition liability before allocating incremental capex to legacy assets. Separate maintenance capex from growth capex on coal fleet. Redeploy freed capital to renewable baseload.',
  },
  {
    id: 'nature-based', number: 18, layer: 'valuation',
    title: 'Nature-Based Solutions Monetization',
    caseCompany: 'Indonesian Peatland and Forestry',
    tension: 'Carbon credit revenue stream dependent on verification timelines mismatched against investor liquidity expectations. Additionality risk and permanence risk unpriced.',
    quantitative: 'Verification cycle 2–3 years → Carbon price volatility 30–50% → Permanence reversal risk unhedged → Investor liquidity expectation 12–24 months → Structural mismatch creates financing gap',
    rule: 'Match carbon credit tenor with underlying ecosystem recovery period. Price additionality and permanence risk explicitly. Structure liquidity facility to bridge verification cycles.',
  },
  {
    id: 'premature-deindustrialization', number: 19, layer: 'structural-transformation',
    title: 'Premature Deindustrialization Trap',
    caseCompany: 'Indonesian Manufacturing Sector',
    tension: 'Manufacturing capex generates output growth but not structural employment. Private capital follows productivity signals, not social transformation logic. The gap between where capital flows and where structural transformation requires it widens without sovereign coordination.',
    quantitative: 'Manufacturing employment share declining despite output growth → Labor productivity gap formal vs informal 3–5x → Private capital follows ROIC signal not structural employment signal → Sovereign coordination required to bridge gap',
    rule: 'Private capital will not self-correct toward structural transformation. Sovereign capital must create the conditions — de-risk the entry, set performance criteria, build coordinating institutions — that make private capital movement rational.',
  },
  {
    id: 'derisking-architecture', number: 20, layer: 'structural-transformation',
    title: 'De-risking Architecture Design',
    caseCompany: 'Saratoga × Danantara Mandate',
    tension: 'Sovereign de-risking fails when designed by people who have never sat on the private capital side. Conditionality gets wrong. Monitoring is performative. First-loss sizing miscalibrated. Private capital reads the architecture and stays out.',
    quantitative: 'First-loss layer sized incorrectly → Private capital mobilization ratio fails to reach 1:4 threshold → Sovereign capital absorbs full risk with no private leverage → De-risking instrument becomes a subsidy → Capital efficiency collapses',
    rule: 'De-risking architecture must be designed by someone who has been on the other side of the table. Embeddedness, conditionality, performance monitoring, and exit criteria are not bureaucratic requirements — they are the precise mechanisms that determine whether private capital treats sovereign involvement as a credibility signal or a warning sign.',
  },
  {
    id: 'structural-sequencing', number: 21, layer: 'structural-transformation',
    title: 'Structural Capital Sequencing',
    caseCompany: 'Indonesia Green Transition Pipeline',
    tension: 'Simultaneous capital demands across transition infrastructure, strategic downstream industries, and legacy asset retirement. Without explicit sequencing logic, capital gets allocated by political priority rather than structural return. Capital deployed out of sequence destroys optionality in subsequent tranches.',
    quantitative: 'Geothermal concessional stack → unlocks renewable baseload → enables coal retirement → JETP tranche activated → nickel downstream de-risked → EV supply chain anchored → sequencing error at any stage collapses mobilization ratio downstream',
    rule: 'Structural transformation capital must be sequenced, not just allocated. Map the capital dependency chain before committing tranches. Sovereign capital deployed in the wrong order cannot be recovered — it locks subsequent stages into suboptimal structures.',
  },
];

export function getConditionByNumber(num: number): CapitalCondition | undefined {
  return CONDITIONS.find((c) => c.number === num);
}

export function getLayerLabel(layerKey: CapitalCondition['layer']): string {
  return LAYERS.find((l) => l.key === layerKey)?.label ?? layerKey;
}

/** Flat ordered list for prev/next navigation */
export const CONDITION_ORDER: number[] = LAYER_ORDER.flatMap((l) => l.conditionNumbers);
