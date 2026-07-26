-- Finance writing backlog: replace 17 stale Website children with 4 tracks.
--
-- The previous seed came from a stale snapshot of the owner's website repo.
-- Two compounding errors: DDS migration 20260301070510 deletes the old
-- `fundamentals` modules and rebuilds the curriculum, and 20260218_001 renamed
-- two track slugs (planning-forecasting -> planning, financial-analytics ->
-- analytics), so searching the old slugs returned nothing and those two tracks
-- were seeded with 6 module titles apiece instead of their 25 real essays.
--
-- One child per TRACK, not per module: 49 module children would swamp the
-- GROWTH project list, so the module number rides as an `NN · ` prefix on the
-- milestone text and grouping stays readable in a flat ordered list.
--
-- Milestone ids are DERIVED from (track, module, sequence) rather than
-- gen_random_uuid(), which is what makes a second run reproduce identical rows
-- instead of duplicating anything.
--
-- APPLIED 2026-07-26 by executing the statements below directly, NOT through a
-- supabase CLI migration command: the repo's filenames and the live ledger use
-- different version numbering, so any CLI migration command would replay the
-- whole history from 0001 against live data. No ledger row was added, for the
-- same reason — its version could not match this filename anyway. Pure DML,
-- no DDL, so nothing about the schema depends on the ledger knowing.
--
-- RE-RUN BEHAVIOUR: this is a wholesale replacement of these four children, so
-- a second run restores the pristine backlog and discards any milestone ticked
-- done on them since. That is the intended semantics for a backlog nobody has
-- started; it is NOT a safe repair tool once writing is under way.

-- Guarded by the exact title list, never by category = 'finance' alone -- that
-- would also sweep up anything added later. The last four titles are the new
-- tracks themselves, deleted so the inserts below are a clean replacement.
delete from public.os_projects
 where parent_id =
  (select id from public.os_projects
    where title = 'Website (writing)' and domain = 'growth' and parent_id is null)
   and title in (
     'Finance · Fundamentals · The Purpose of Financial Management',
     'Finance · Fundamentals · The Business, Tax, and Financial Environment',
     'Finance · Fundamentals · Time Value of Money',
     'Finance · Fundamentals · Valuation of Securities',
     'Finance · Fundamentals · Risk and Return',
     'Finance · Fundamentals · Financial Statement Analysis',
     'Finance · Fundamentals · Cash Flow Analysis and Financial Planning',
     'Finance · Fundamentals · Working Capital Management',
     'Finance · Fundamentals · Capital Budgeting',
     'Finance · Fundamentals · Cost of Capital and Required Returns',
     'Finance · Fundamentals · Capital Structure and Leverage',
     'Finance · Fundamentals · Dividend Policy',
     'Finance · Fundamentals · Capital Markets and Financing Instruments',
     'Finance · Fundamentals · Mergers, Restructuring, and International Finance',
     'Finance · Strategic Finance',
     'Finance · Planning & Forecasting',
     'Finance · Financial Analytics',
     'Finance · Fundamentals'
   );

-- Finance · Fundamentals — 56 milestones
insert into public.os_projects
  (id, domain, title, type, status, category, parent_id, sort_order, target_metric,
   working_title, deadline, start_date, date_confidence, recurring, period,
   entity_tag, dashboard_pinned, linked_projects, documents, milestones)
select
  '01000000-0000-4000-8000-000000000000', 'growth', 'Finance · Fundamentals', 'build', 'active',
  'finance',
  (select id from public.os_projects
    where title = 'Website (writing)' and domain = 'growth' and parent_id is null),
  401, 'Core concepts every finance professional must master.',
  null, null, null, null, null, null,
  null, false, '[]'::jsonb, '[]'::jsonb,
  jsonb_agg(jsonb_build_object(
    'id',   format('01%s%s00-0000-4000-8000-000000000000',
                   lpad(m::text, 2, '0'), lpad(s::text, 2, '0'))::uuid,
    'text', lpad(m::text, 2, '0') || ' · ' || t,
    'note', n,
    'status', 'not-started', 'done', false, 'pic', null, 'documents', '[]'::jsonb
  ) order by ord)
from (values
  (1,1,1,'The Objective Function of the Firm','Why Value Maximization Is Analytically Superior to Stakeholder Balance as an Organizing Principle'),
  (2,1,2,'The CFO as Capital Doctrine Architect','Agency Structure, Board Mandate, and the Governance of Financial Decision Rights'),
  (3,2,1,'Tax as a Capital Structure Variable','How Legal Entity Architecture, Debt Tax Shields, and Transfer Pricing Shape After-Tax Firm Value'),
  (4,2,2,'Regulatory Environment and the Cost of Capital','How Jurisdiction, Institutional Quality, and Legal Systems Price Financial Risk'),
  (5,3,1,'Discounting as an Epistemological Commitment','The Mathematical and Economic Logic of Present Value in Capital Decisions'),
  (6,3,2,'Perpetuities, Terminal Value, and the Arithmetic of Long-Duration Capital','Why Small Assumption Changes Produce Large Valuation Errors'),
  (7,4,1,'Bond Pricing, Duration, and Convexity','How Fixed Income Mathematics Translates Credit and Rate Risk into Price'),
  (8,4,2,'Equity Valuation Models and Their Embedded Assumptions','DDM, Gordon Growth, and the Conditions Under Which They Fail'),
  (9,4,3,'Instrument Design and Pricing Implications','Why the Form of a Security Affects Its Cost and Risk Profile Before Any Trade Is Made'),
  (10,5,1,'FCFF vs. FCFE','When to Value the Firm and When to Value Equity, and Why the Choice Is Never Arbitrary'),
  (11,5,2,'Terminal Value Architecture','Why 60-80% of DCF Value Lives in a Number That Depends Entirely on Assumptions About the Distant Future'),
  (12,5,3,'Multiples as Compressed DCF Models','The Theoretical Basis for EV/EBITDA, P/E, and P/B and Their Systematic Failure Modes'),
  (13,5,4,'Sum-of-Parts Valuation in Conglomerate and Holding Company Structures','When Segment Disaggregation Reveals the Conglomerate Discount'),
  (14,6,1,'Diversification as a Free Lunch','The Mathematics of Covariance Reduction and the Efficient Frontier'),
  (15,6,2,'Systematic Risk vs. Idiosyncratic Risk','Why Only One Type Is Priced in Equilibrium and What That Means for Capital Allocation'),
  (16,6,3,'Portfolio Theory Under Non-Normal Distributions','Skewness, Fat Tails, and the Failure of Variance as a Complete Risk Measure'),
  (17,7,1,'The Capital Asset Pricing Model','Derivation, Empirical Failures, and Why It Remains the Default Discount Rate Framework'),
  (18,7,2,'Fama-French Three-Factor and Five-Factor Models','What Value, Size, Profitability, and Investment Premia Say About Market Pricing'),
  (19,7,3,'Beta Estimation in Practice','Mean Reversion, Leverage Adjustment, Industry Proxies, and the Measurement Problem That Undermines Every WACC'),
  (20,8,1,'Revenue Recognition and Accruals Engineering','How Accounting Choices Distort Reported Income Without Affecting Cash'),
  (21,8,2,'Off-Balance-Sheet Financing and Liability Concealment','Operating Leases, SPVs, and Contingent Obligations as Hidden Capital Structure'),
  (22,8,3,'Cash Flow Statement as the Truth Document','Why Free Cash Flow Cannot Be Manipulated in the Same Way Earnings Can'),
  (23,9,1,'DuPont Decomposition as a Strategic Diagnostic','How ROE Can Rise While the Business Deteriorates'),
  (24,9,2,'Profitability Analysis Across the Income Statement','Why Gross Margin, EBIT Margin, and NOPAT Tell Different Stories About Competitive Position'),
  (25,9,3,'Distress Prediction from Financial Statements','Altman Z-Score, Ohlson O-Score, and the Limits of Formula-Based Early Warning Systems'),
  (26,10,1,'The Three-Statement Model as an Epistemological Framework','How IS, BS, and CF Constraints Discipline Financial Assumptions'),
  (27,10,2,'Free Cash Flow Derivation','The Accounting-to-Economics Translation That Most Financial Models Get Wrong'),
  (28,10,3,'Integrated Forecasting Under Uncertainty','Assumptions Architecture, Circularity Management, and Model Hygiene in Complex Financial Projections'),
  (29,11,1,'The Cash Conversion Cycle as a Capital Decision','Why Working Capital Is Operating Capital and Must Be Funded as Such'),
  (30,11,2,'Receivables, Payables, and Inventory Trade-offs','How Working Capital Optimization Creates and Destroys Value Simultaneously Across the Supply Chain'),
  (31,12,1,'NPV as the Foundational Capital Allocation Criterion','Why IRR, Payback, and MIRR Are Approximations of an Idea NPV Expresses Exactly'),
  (32,12,2,'Incremental Cash Flow Analysis','Side Costs, Cannibalization, Opportunity Costs, and the Systematic Errors That Inflate Project Returns'),
  (33,12,3,'Capital Rationing and Mutually Exclusive Projects','How Portfolio Constraints Change the Optimal Investment Decision'),
  (34,13,1,'Real Options as Anti-NPV Correction','When Deferral, Expansion, and Abandonment Rights Are Worth More Than the Base Case Cash Flows'),
  (35,13,2,'Decision Tree Analysis and Option Pricing in Capital Budgeting','From Qualitative Intuition to Quantifiable Strategic Premiums'),
  (36,13,3,'The Option to Abandon as a Risk Management Tool','How Exit Rights Change the Ex-Ante Investment Decision for Capital-Intensive Projects'),
  (37,14,1,'WACC Construction and Its Five Most Common Errors','Market Weights, Marginal Cost, Tax Shield Timing, Beta Adjustment, and the Circularity Problem'),
  (38,14,2,'Divisional Hurdle Rates and the Capital Allocation Distortion Created by Firm-Wide WACC','How Uniform Discount Rates Systematically Misallocate Investment'),
  (39,14,3,'Country Risk Premium Estimation for Emerging Markets','Damodaran Methodology, CDS Spreads, and the Debate Over Whether Political Risk Is Diversifiable'),
  (40,15,1,'Modigliani-Miller Propositions I and II','The Logic of Irrelevance, Why It Holds in Theory, and the Specific Frictions That Destroy It in Practice'),
  (41,15,2,'Trade-Off Theory vs. Pecking Order','Two Internally Consistent Frameworks That Predict Opposite Financing Behavior in Growing Firms'),
  (42,15,3,'Optimal Leverage and the Operating Income Approach','How to Find the Debt Level That Minimizes WACC Without Relying on MM''s Perfect Market Assumptions'),
  (43,16,1,'Adverse Selection and the Lemons Problem in Corporate Financing','Why Information Asymmetry Between Managers and Investors Determines Security Choice'),
  (44,16,2,'Moral Hazard and Incentive-Compatible Financing','How Convertibles, Warrants, and Covenants Solve the Asset Substitution Problem'),
  (45,16,3,'Security Design from First Principles','Why Debt, Equity, and Hybrids Exist as Distinct Instruments Rather Than Points on a Single Continuum'),
  (46,17,1,'Debt as a Disciplining Device','How Leverage Constrains Managerial Free Cash Flow and Forces Investment Discipline Without Board Intervention'),
  (47,17,2,'Control Rights in Debt Contracts','How Covenant Architecture Allocates Decision Authority Between Managers and Creditors as Firm Performance Varies'),
  (48,17,3,'The Market for Corporate Control','Hostile Takeovers, the Free-Rider Problem, and Why Grossman-Hart Changes the Economics of Minority Shareholding'),
  (49,18,1,'Dividend Irrelevance and Its Conditions','Why Modigliani-Miller''s Proof Is Correct Inside a Model That No Real Firm Inhabits'),
  (50,18,2,'Signaling, Clientele Effects, and the Tax Argument','The Three Competing Explanations for Why Dividend Policy Changes Move Stock Prices'),
  (51,19,1,'The Efficient Market Hypothesis Across Its Three Forms','What Each Form Implies for Security Analysis, Active Management, and Corporate Financing Decisions'),
  (52,19,2,'Behavioral Finance and Market Anomalies','Momentum, Value Premium, Post-Earnings Drift, and What Persistent Anomalies Tell Us About How Prices Are Set'),
  (53,19,3,'Capital Markets Structure and the Economics of Issuance','Why the Method of Raising Capital Affects Its Cost and Signal'),
  (54,20,1,'Cross-Border Capital Structure','How Tax Treaties, Capital Controls, Thin Capitalization Rules, and Jurisdictional Arbitrage Determine Optimal Financing for Multinationals'),
  (55,20,2,'Country Risk and the Cost of Capital in Emerging Markets','Sovereign Spreads, Political Risk Insurance, and the Limits of Quantitative Country Risk Models'),
  (56,20,3,'ASEAN Capital Markets Architecture','Depth, Liquidity, Instrument Availability, and the Constraints They Place on Capital Allocation for Indonesian Multinationals')
) as v(ord, m, s, t, n);

-- Finance · Strategic Finance — 55 milestones
insert into public.os_projects
  (id, domain, title, type, status, category, parent_id, sort_order, target_metric,
   working_title, deadline, start_date, date_confidence, recurring, period,
   entity_tag, dashboard_pinned, linked_projects, documents, milestones)
select
  '02000000-0000-4000-8000-000000000000', 'growth', 'Finance · Strategic Finance', 'build', 'active',
  'finance',
  (select id from public.os_projects
    where title = 'Website (writing)' and domain = 'growth' and parent_id is null),
  402, 'Applied decision-making at CFO and board level.',
  null, null, null, null, null, null,
  null, false, '[]'::jsonb, '[]'::jsonb,
  jsonb_agg(jsonb_build_object(
    'id',   format('02%s%s00-0000-4000-8000-000000000000',
                   lpad(m::text, 2, '0'), lpad(s::text, 2, '0'))::uuid,
    'text', lpad(m::text, 2, '0') || ' · ' || t,
    'note', n,
    'status', 'not-started', 'done', false, 'pic', null, 'documents', '[]'::jsonb
  ) order by ord)
from (values
  (1,1,1,'The Principal-Agent Problem as the Central Problem of Corporate Finance','How the Separation of Ownership and Control Creates Costs That Capital Structure and Governance Mechanisms Exist to Manage'),
  (2,1,2,'Board Architecture and CFO Accountability','Independence, Audit Committee Design, and the Governance Structures That Actually Constrain Executive Behavior'),
  (3,1,3,'Ownership Concentration and Governance Quality in Emerging Market Business Groups','Why Blockholder Monitoring and Tunneling Coexist in the Same Institutional Structure'),
  (4,1,4,'Stakeholder Capitalism vs. Shareholder Primacy','The Empirical Record, the Contractual Argument, and Why the Debate Matters for Capital Allocation Doctrine'),
  (5,2,1,'ROIC as the Master Capital Allocation Metric','Why Return on Invested Capital Above the Cost of Capital Is the Necessary and Sufficient Condition for Value Creation'),
  (6,2,2,'The Capital Allocation Hierarchy','How Boards and CFOs Should Prioritize Between Organic Investment, M&A, Debt Reduction, and Shareholder Returns Across the Business Cycle'),
  (7,2,3,'Portfolio Capital Allocation in Multi-Business Firms','BCG Matrix, McKinsey GE Framework, and Why Internal Capital Markets Systematically Misallocate Relative to External Markets'),
  (8,2,4,'The Capital Budget as a Governance Document','How the Annual Investment Approval Process Either Enforces or Undermines the Strategic Capital Allocation Framework'),
  (9,2,5,'Communicating Capital Allocation Doctrine to Boards and Investors','The Investor Letter, the Capital Markets Day, and the Metrics That Build Long-Term Institutional Credibility'),
  (10,3,1,'Synergy Valuation Methodology','How to Decompose Revenue, Cost, and Financial Synergies into Present Value Without Replicating the Optimism Bias That Destroys M&A Value'),
  (11,3,2,'Deal Structure and Consideration Design','When to Use Cash vs. Stock, How Earnouts Solve Valuation Disagreements, and the Tax Implications of Each Structure'),
  (12,3,3,'Accretion/Dilution Analysis as a Flawed Primary Decision Framework','Why EPS Accretion Is a Necessary but Insufficient Condition for Value Creation'),
  (13,3,4,'Post-Merger Integration Failure','The Organizational, Cultural, and Financial Mechanisms Through Which 60–70% of Acquisitions Destroy Shareholder Value'),
  (14,3,5,'LBO Architecture and Return Attribution','How Leverage, Multiple Expansion, and Operational Improvement Each Contribute to Private Equity Returns'),
  (15,4,1,'Spin-Off, Carve-Out, and Split-Off','The Valuation Logic for Separation Transactions and When Sum-of-Parts Exceeds Conglomerate Value'),
  (16,4,2,'Balance Sheet Restructuring as Strategic Finance','How Recapitalizations, Debt-for-Equity Swaps, and Liability Management Operations Change the Risk Profile of the Firm'),
  (17,4,3,'Distress-Driven Restructuring','The Decision Tree from Covenant Breach to Out-of-Court Workout to Chapter 11, and How Each Path Allocates Value Across Claimants'),
  (18,4,4,'Divestitures as Capital Reallocation','How Asset Sales, Sale-Leasebacks, and Portfolio Simplification Programs Release Trapped Value and Fund Core Investment'),
  (19,5,1,'The Operating Income Approach to Optimal Leverage','How to Use Cash Flow Stress Tests to Find the Debt Level a Business Can Sustain Across the Cycle Without Covenant Breach'),
  (20,5,2,'Financing Instrument Selection Under Information Asymmetry','Why the Pecking Order Reflects a Rational Response to Adverse Selection Rather Than Simple Preference'),
  (21,5,3,'Credit Rating Management as a Capital Structure Objective','How CFOs Engineer Leverage, Coverage, and Liquidity to Target and Defend Specific Rating Levels'),
  (22,5,4,'Capital Structure Across the Business Cycle','When to Lever Up, When to Deleverage, and How to Use the Cycle to Refinance at Lower Rates Before Others Do'),
  (23,5,5,'Convertible Bonds, Hybrid Instruments, and the Strategic Use of Ambiguous Securities','How Instruments at the Debt-Equity Boundary Solve Specific Contracting and Signaling Problems'),
  (24,6,1,'Duration, Convexity, and the Interest Rate Sensitivity of Debt Portfolios','How Small Rate Movements Translate Into Large Market Value Changes for Long-Duration Liabilities'),
  (25,6,2,'Fixed vs. Floating Debt Strategy Under Different Rate Environments','When to Lock In Rates, When to Stay Variable, and How the Choice Interacts With Asset Duration'),
  (26,6,3,'Interest Rate Swap Architecture','How Plain Vanilla, Basis, and Cross-Currency Swaps Are Used to Engineer the Desired Rate Exposure Without Altering Debt Principal'),
  (27,6,4,'Refinancing Risk and Debt Maturity Management','How Laddering, Bullet Avoidance, and Covenant-Aware Refinancing Protect Against Liquidity Events'),
  (28,7,1,'Credit Rating Agency Methodology','How S&P, Moody''s, and Fitch Convert Financial Ratios into Letter Ratings, and Why the Same EBITDA Can Support Different Ratings in Different Industries'),
  (29,7,2,'Covenant Architecture and Control Rights Transfer','How Maintenance Covenants, Incurrence Covenants, and Cross-Default Provisions Reallocate Decision Authority from Management to Creditors'),
  (30,7,3,'Distress Prediction Frameworks','Altman Z-Score, Ohlson O-Score, and the Financial Ratios That Signal Distress 12–24 Months Before Default'),
  (31,7,4,'Out-of-Court Restructuring vs. Formal Insolvency','The Economics of Consent Solicitations, Exchange Offers, and Pre-Packaged Plans — and Who Bears the Cost of Each Process'),
  (32,7,5,'Lender Negotiation in Distress','The Information Asymmetry Between Debtor and Creditor, Holdout Problems, and How CFOs Manage the Stakeholder Map in Financial Distress'),
  (33,8,1,'Transaction, Translation, and Economic FX Exposure','Why the Third Is the Most Important and the Most Difficult to Hedge, and How Multinationals Systematically Underestimate It'),
  (34,8,2,'FX Hedging Instruments','Forwards, Futures, Options, and Cross-Currency Swaps — Construction, Cost, and the Conditions Under Which Each Is Preferred'),
  (35,8,3,'Natural Hedging and Operational FX Management','How Revenue Currency Matching, Local Funding, and Supply Chain Design Reduce FX Exposure Before Financial Instruments Are Required'),
  (36,8,4,'IFRS 9 Hedge Accounting and Its CFO Implications','Qualifying Hedges, Effectiveness Testing, and How Accounting Treatment Affects the Incentive to Hedge'),
  (37,9,1,'Options Pricing Logic','How Black-Scholes Translates Volatility, Time, and the Risk-Free Rate into a Premium — and Why Understanding the Greeks Matters for Corporate Hedging Decisions'),
  (38,9,2,'Corporate Commodity Hedging Strategy','When to Hedge Commodity Input Prices, How Much to Hedge, Over What Horizon, and How to Communicate the Hedging Policy to Investors'),
  (39,9,3,'Credit Default Swaps as Capital Structure Instruments','How CDS Spreads Price Default Risk and Why They Matter for Treasury Risk Monitoring'),
  (40,9,4,'When Not to Hedge','The Cases Where Hedging Destroys Value — Speculative Positions, Benchmark Confusion, and the Risk of Replacing Operational Risk with Counterparty Risk'),
  (41,10,1,'The Dividend vs. Buyback Decision','How Tax Position, Signaling Intent, Flexibility Requirements, and Investor Base Composition Should Drive the Payout Instrument Choice'),
  (42,10,2,'Buyback Mechanics','Open Market Repurchases, Fixed-Price Tenders, Accelerated Share Repurchases, and How Each Is Perceived by the Market'),
  (43,10,3,'Payout Policy Across the Capital Allocation Hierarchy','How CFOs Should Frame the Decision to Return Capital vs. Reinvest — and Why Most Payout Announcements Are Made at the Wrong Point in the Cycle'),
  (44,10,4,'Information Content of Payout Decisions','How Initiating, Increasing, Cutting, or Suspending Dividends Signals Management''s Private Information About Future Earnings Quality'),
  (45,10,5,'Activist Shareholder Engagement and Payout Pressure','The Playbook, the Counter-Arguments, and How CFOs Construct a Capital Return Narrative That Preempts Activism'),
  (46,11,1,'ROIC Decomposition','How Splitting Return on Invested Capital Into Margin and Asset Turnover Reveals Whether Value Creation Is Driven by Pricing Power or Capital Efficiency'),
  (47,11,2,'Economic Value Added as a Management Incentive System','EVA Construction, Capital Charge Design, and the Conditions Under Which EVA Compensation Actually Aligns Management With Shareholders'),
  (48,11,3,'Value Driver Trees and Strategic Operating Decisions','How to Connect Revenue Growth, Operating Margin, Capital Intensity, and Cost of Capital Into a Single Coherent Value Map for the Board'),
  (49,11,4,'Intrinsic Value vs. Market Value','Why They Diverge, How to Identify When the Gap Is Large Enough to Act On, and What the CFO Can Do to Close It'),
  (50,12,1,'Green Bond and Sustainability-Linked Bond Mechanics','How Instrument Design, Use-of-Proceeds Requirements, and KPI Linkage Affect Pricing Relative to Vanilla Debt'),
  (51,12,2,'Climate-Adjusted Cost of Capital','The Theoretical Framework for Incorporating Physical Risk and Transition Risk Into Discount Rates, and Why Current Market Practice Underestimates Both'),
  (52,12,3,'TCFD Disclosure and the Board''s Financial Obligations','How Climate Risk Scenario Analysis Translates Into Balance Sheet Stress, Capex Reallocation, and Stranded Asset Provisions'),
  (53,13,1,'Legal System Quality and the Cost of Capital','How Investor Protection, Contract Enforcement, and Property Rights Are Priced Into Required Returns in Emerging Markets'),
  (54,13,2,'State-Owned Enterprise Governance and Capital Allocation Distortions','How Political Objectives, Implicit Guarantees, and Soft Budget Constraints Distort Investment Decisions in SOE-Adjacent Industries'),
  (55,13,3,'Conglomerate Finance in Indonesian Business Groups','How Cross-Subsidiary Guarantee Structures, Internal Capital Markets, and Group-Level Treasury Create Risk Exposures That External Investors Consistently Misprice')
) as v(ord, m, s, t, n);

-- Finance · Planning & Forecasting — 25 milestones
insert into public.os_projects
  (id, domain, title, type, status, category, parent_id, sort_order, target_metric,
   working_title, deadline, start_date, date_confidence, recurring, period,
   entity_tag, dashboard_pinned, linked_projects, documents, milestones)
select
  '03000000-0000-4000-8000-000000000000', 'growth', 'Finance · Planning & Forecasting', 'build', 'active',
  'finance',
  (select id from public.os_projects
    where title = 'Website (writing)' and domain = 'growth' and parent_id is null),
  403, 'Translating strategy into operational financial management.',
  null, null, null, null, null, null,
  null, false, '[]'::jsonb, '[]'::jsonb,
  jsonb_agg(jsonb_build_object(
    'id',   format('03%s%s00-0000-4000-8000-000000000000',
                   lpad(m::text, 2, '0'), lpad(s::text, 2, '0'))::uuid,
    'text', lpad(m::text, 2, '0') || ' · ' || t,
    'note', n,
    'status', 'not-started', 'done', false, 'pic', null, 'documents', '[]'::jsonb
  ) order by ord)
from (values
  (1,1,1,'Zero-Based vs. Incremental Budgeting','Why the Choice Is Not About Methodology but About What Management Culture the Budget Process Is Designed to Produce'),
  (2,1,2,'Three-Statement Budget Integration','How Plug Variables, Circular References, and Cash Sweep Mechanics Work in an Institutionally Robust Integrated Financial Model'),
  (3,1,3,'Budget Governance and the CFO''s Role in Preventing Budget Gaming','Sandbagging, Padding, and the Information Asymmetry Between Business Units and the Center'),
  (4,1,4,'Connecting Budget Architecture to Strategic Capital Allocation','How the Annual Budget Must Be Derived From the Capital Allocation Framework, Not Constructed Independently of It'),
  (5,2,1,'Rolling Forecast vs. Annual Budget','Why Separating the Forecast Function From the Target-Setting Function Eliminates Forecast Bias Without Eliminating Accountability'),
  (6,2,2,'Reforecast Cadence Design','How to Choose Between Monthly, Quarterly, and Event-Triggered Reforecasting Based on Business Cycle Volatility and Decision-Making Speed'),
  (7,2,3,'Building a Forecast Culture','How CFOs Eliminate Anchoring Bias, Recency Bias, and Sandbagging From the Forecast Process Without Destroying the Forecasters'' Willingness to Commit'),
  (8,3,1,'Macro Scenario Construction for CFOs','How to Build Economically Consistent Base, Upside, and Downside Scenarios That Are Useful for Decision-Making Rather Than Just Risk Disclosure'),
  (9,3,2,'Reverse Stress Testing','Starting From the Breaking Point — How to Identify the Scenario in Which the Business Model Fails and Work Backward to Understand Its Proximity'),
  (10,3,3,'Covenant Stress Testing and Headroom Management','How to Model Financial Covenant Compliance Under Adverse Scenarios and Determine the Liquidity Buffer Required to Avoid Breach'),
  (11,3,4,'Communicating Scenarios to Boards and Lenders','How to Present Uncertainty Without Creating Panic, and How to Use Scenarios to Drive Capital Allocation Decisions Rather Than Justify Inaction'),
  (12,4,1,'Cash Pooling Structures for Multinational Groups','Notional vs. Physical Pooling, In-House Banking, and the Legal, Tax, and Regulatory Constraints That Determine Which Structure Is Feasible'),
  (13,4,2,'Short-Term Funding Markets and Corporate Liquidity Infrastructure','Commercial Paper, Money Market Facilities, and How Treasury Constructs the Funding Stack That Buffers Against Operational Cash Volatility'),
  (14,4,3,'Counterparty Risk in Treasury Operations','How to Design Bank Relationship Limits, Collateral Requirements, and Settlement Protocols That Prevent Treasury From Becoming a Source of Concentration Risk'),
  (15,5,1,'The 13-Week Cash Flow Model','Construction, Driver Assumptions, and How Weekly Liquidity Visibility Changes the Quality of Board-Level Decisions in Stressed Environments'),
  (16,5,2,'Minimum Cash Balance Policy','How to Determine the Structural Liquidity Floor Below Which Operating Risk Materializes, and How That Floor Changes Across Business Cycle Phases'),
  (17,5,3,'Early Warning Indicators for Liquidity Deterioration','The Financial Ratios, Operating Metrics, and Covenant Headroom Thresholds That Precede Distress by Six to Twelve Months'),
  (18,5,4,'Cash Crisis Protocol','The Decision Tree from First Liquidity Warning to Emergency Capital Raise, and How CFOs Sequence Actions to Preserve Maximum Stakeholder Value'),
  (19,6,1,'Receivables Management and Working Capital Financing','Invoice Factoring, Receivables Securitization, Dynamic Discounting, and How Each Trades Yield Against Balance Sheet Risk'),
  (20,6,2,'Payables Extension as a Financing Strategy','Supply Chain Finance, Reverse Factoring, and the Ethical and Reputational Constraints That Limit How Far Payables Stretching Can Go'),
  (21,6,3,'Inventory Optimization and Cash Conversion','How Demand Variability, Lead Time Reduction, and Safety Stock Calculations Translate Into Working Capital Release and Free Cash Flow Generation'),
  (22,6,4,'Working Capital in M&A Due Diligence','How Normalized Working Capital Peg Calculations, Seasonality Adjustments, and Working Capital Quality Analysis Determine the True Cash Price of an Acquisition'),
  (23,7,1,'Modeling Capital Requirements From Growth Assumptions','How to Build a Bottoms-Up Funding Needs Model That Connects Revenue Growth, Operating Investment, and Working Capital Absorption Into a Funding Requirement'),
  (24,7,2,'Equity Dilution Modeling','How to Calculate Pre-Money Valuation, Dilution Impact, Ownership Waterfall, and Anti-Dilution Mechanics for Funding Round Negotiations'),
  (25,7,3,'The Investor-Ready Financial Package','How CFOs Structure Financial Projections, Sensitivity Analysis, and Covenant Headroom Documentation to Reduce Information Asymmetry With Lenders and Investors')
) as v(ord, m, s, t, n);

-- Finance · Financial Analytics — 25 milestones
insert into public.os_projects
  (id, domain, title, type, status, category, parent_id, sort_order, target_metric,
   working_title, deadline, start_date, date_confidence, recurring, period,
   entity_tag, dashboard_pinned, linked_projects, documents, milestones)
select
  '04000000-0000-4000-8000-000000000000', 'growth', 'Finance · Financial Analytics', 'build', 'active',
  'finance',
  (select id from public.os_projects
    where title = 'Website (writing)' and domain = 'growth' and parent_id is null),
  404, 'Quantitative tools and diagnostic intelligence for finance professionals.',
  null, null, null, null, null, null,
  null, false, '[]'::jsonb, '[]'::jsonb,
  jsonb_agg(jsonb_build_object(
    'id',   format('04%s%s00-0000-4000-8000-000000000000',
                   lpad(m::text, 2, '0'), lpad(s::text, 2, '0'))::uuid,
    'text', lpad(m::text, 2, '0') || ' · ' || t,
    'note', n,
    'status', 'not-started', 'done', false, 'pic', null, 'documents', '[]'::jsonb
  ) order by ord)
from (values
  (1,1,1,'Matrix Operations as Financial Infrastructure','How Covariance Matrices, Factor Loading Matrices, and OLS in Matrix Form Underlie Every Multi-Asset Risk and Regression Calculation in Finance'),
  (2,1,2,'Eigenvalue Decomposition in Portfolio Analysis','How Principal Component Analysis Identifies the Dominant Sources of Portfolio Variance That Simple Correlation Analysis Misses'),
  (3,2,1,'Optimization as Capital Decision Logic','How First-Order Conditions, Lagrange Multipliers, and the KKT Conditions Formalize the CFO''s Resource Allocation Problem'),
  (4,2,2,'Convexity in Financial Decision Problems','Why Convex Objective Functions Are Desirable, How Concavity Produces Risk Aversion, and What Both Imply for Capital Allocation Under Uncertainty'),
  (5,3,1,'Probability Distributions in Finance','How Normal, Lognormal, and Fat-Tailed Distributions Model Different Financial Phenomena, and Why Choosing the Wrong Distribution Produces Systematically Wrong Risk Estimates'),
  (6,3,2,'Regression Analysis for Financial Inference','OLS Assumptions, Diagnostic Testing, and How Violations of Gauss-Markov Conditions Produce Unreliable Beta, Cost of Capital, and Driver Estimates'),
  (7,3,3,'Stochastic Processes and Option Pricing Foundations','Brownian Motion, Geometric Brownian Motion, and the Mathematical Bridge from Asset Price Dynamics to the Black-Scholes Formula'),
  (8,4,1,'DuPont as a Strategic Management System','How Decomposing ROE Into Profit Margin, Asset Turnover, and Financial Leverage Connects Accounting Output to Operating Strategy'),
  (9,4,2,'Ratio Benchmarking Methodology','How to Select Comparable Firms, Adjust for Accounting Differences, and Interpret Cross-Sectional Ratio Dispersion Without False Precision'),
  (10,4,3,'Detecting Financial Deterioration Before Default','The Sequence of Ratio Degradation — From Profitability to Coverage to Liquidity to Solvency — and the Time Lags Between Each'),
  (11,5,1,'Contribution Margin Architecture Across Business Models','How Unit Economics Differ Structurally Between Asset-Heavy Industrial Firms, Platform Businesses, and Subscription Models'),
  (12,5,2,'Customer Lifetime Value and Customer Acquisition Cost','The Unit Economic Foundation for Growth Investment Decisions, and Why LTV/CAC Ratios Without Cohort-Level Data Are Almost Always Wrong'),
  (13,5,3,'Operating Leverage Quantification','How Fixed vs. Variable Cost Structure Translates Into Earnings Volatility, and Why High Operating Leverage Changes the Optimal Capital Structure'),
  (14,6,1,'Price-Volume-Mix Variance Decomposition','The Mathematical Structure of Three-Way Attribution and Why the Cross-Term Assignment Convention Has Managerial Implications'),
  (15,6,2,'Bridge Analysis Construction for Board Reporting','How to Build a Waterfall Chart That Moves From Prior Period to Current Period Performance With Each Bridge Column Representing a Single Clean Cause'),
  (16,6,3,'Root Cause Isolation vs. Symptom Identification','How to Distinguish First-Order Variance Drivers From Second-Order Effects, and Why Most Variance Commentaries Stop Too Early'),
  (17,7,1,'Driver Tree Construction','How to Map a Business Model''s Value Creation Logic Into a Hierarchical Set of Quantifiable Drivers That Connect KPIs to Financial Line Items'),
  (18,7,2,'Driver Sensitivity Ranking','How Partial Derivative Analysis Identifies the Two or Three Drivers That Explain 80% of Forecast Variance, and Why Everything Else Is Noise'),
  (19,7,3,'Updating Forecasts From Driver Signals','How to Build a Forecast Update Protocol That Moves From Operational Leading Indicators to Financial Reforecast Without Waiting for Month-End Close'),
  (20,8,1,'Tornado Chart Construction and Interpretation','How One-Way Sensitivity Analysis Ranks Assumption Risk and Why the Visual Presentation of Sensitivity Changes What Decisions Get Made'),
  (21,8,2,'Monte Carlo Simulation for Capital Decisions','How to Define Probability Distributions for Key Assumptions, Run Correlated Simulations, and Interpret the Output Distribution Without Overstating Precision'),
  (22,8,3,'Decision Tree Analysis Under Sequential Uncertainty','How to Structure Staged Investment Decisions, Assign Probabilities to Branch Nodes, and Calculate Expected Value Including the Option to Stop'),
  (23,9,1,'KPI Selection as a Governance Decision','How to Choose the Minimum Set of Metrics That Gives the Board Sufficient Information to Monitor Strategy Without Creating Reporting Theater'),
  (24,9,2,'Financial Reporting for Different Audiences','How the Same Underlying Financial Data Must Be Structured Differently for the Board, the CFO''s Management Pack, the Lender Compliance Report, and the Investor Presentation'),
  (25,9,3,'Leading vs. Lagging Indicators in Performance Architecture','Why Dashboards Anchored to Lagging Accounting Metrics Systematically Fail to Alert Management Early Enough to Change Outcomes')
) as v(ord, m, s, t, n);
