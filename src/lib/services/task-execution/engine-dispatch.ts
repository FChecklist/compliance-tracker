// dispatchEngine(): the VCEL computation-engine dispatcher (plus its two
// small private helpers, truthy() and parseNumberList(), used only inside
// it). Split out of task-execution-engine.ts for size/responsibility
// reasons (that file was ~2583 lines) -- purely mechanical extraction, no
// behavior change. dispatchEngine() is exported here only because it has
// exactly one real caller, executeEngineDispatch() back in
// task-execution-engine.ts, which imports it from this module; it is not
// intended as a general-purpose external entry point (see
// CAPABILITY_COVERAGE.md for what "external" would even mean here).
import { gstCanonicalInvoices, gstReturnPeriods } from "@/lib/db";
import type { TenantDb } from "@/lib/db/tenant-scoped";
import { eq, and } from "drizzle-orm";
import { assertBusinessRulesBeforeExecution } from "@/lib/business-rule-validator";
import { crossVerifyEmi, crossVerifyGratuity, assertCalculationVerified } from "@/lib/calculation-cross-verification";

// Deliberately a small, explicit allowlist switch -- not a generic resolver
// that dynamic-imports whatever computation_engines.implementation_ref says.
// Letting a database row control which file gets imported and which export
// gets called would be a real code-execution surface; each case here is a
// real, reviewed import instead. GST Engine (16/16), Mathematical
// Computation Engine (10/13), and Costing Engine (8/8) are the categories
// wired so far -- CAPABILITY_COVERAGE.md tracks exactly which of the other
// ~185 registered engines are still unwired and why.
function truthy(v: unknown): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "yes" || s === "true" || s === "1";
}

// Backs every `number_list` CapabilityInputField -- the composer sends the
// raw comma-separated text unparsed, this is the one place it becomes a
// real number[], with a clear error on a malformed entry rather than
// silently coercing "abc" to NaN and letting a bad value flow into a
// calculation undetected.
function parseNumberList(v: unknown): number[] {
  const raw = String(v ?? "").trim();
  if (!raw) return [];
  return raw.split(",").map((part) => {
    const n = Number(part.trim());
    if (!Number.isFinite(n)) throw new Error(`"${part.trim()}" is not a valid number`);
    return n;
  });
}

export async function dispatchEngine(db: TenantDb, orgId: string, userId: string, engineKey: string, inputs: Record<string, unknown>): Promise<unknown> {
  assertBusinessRulesBeforeExecution(engineKey, inputs);
  // Zero typed fields -- validates a real GST return period's own confirmed
  // sales invoices, never a human-typed line-items list. Completes the GST
  // Engine category (16/16).
  if (engineKey === "gst_return_validation_engine") {
    const returnPeriodId = String(inputs.returnPeriodId ?? "");
    if (!returnPeriodId) throw new Error("Missing returnPeriodId");
    const period = await db.query.gstReturnPeriods.findFirst({ where: and(eq(gstReturnPeriods.id, returnPeriodId), eq(gstReturnPeriods.orgId, orgId)) });
    if (!period) throw new Error("Return period not found");
    const invoices = await db.query.gstCanonicalInvoices.findMany({
      where: and(eq(gstCanonicalInvoices.orgId, orgId), eq(gstCanonicalInvoices.period, period.period), eq(gstCanonicalInvoices.direction, "sales")),
    });
    const totalTaxableValue = invoices.reduce((sum, i) => sum + Number(i.taxableValue), 0);
    const totalTaxPaid = invoices.reduce((sum, i) => sum + Number(i.cgstAmount) + Number(i.sgstAmount) + Number(i.igstAmount), 0);
    const { validateGstReturn } = await import("@/lib/engines/in/gst-engine");
    return validateGstReturn({
      gstin: period.gstin, period: period.period,
      totalTaxableValue, totalTaxPaid,
      lineItems: invoices.map((i) => ({ invoiceNumber: i.invoiceNumber, taxableValue: Number(i.taxableValue), totalValue: Number(i.totalValue) })),
    });
  }

  switch (engineKey) {
    // VERIDIAN CRM Wave 4 (2026-07-21): structured, zero-LLM record
    // creation -- the capability-tree leaf (capability-tree-service.ts's
    // buildCrmQuickCreateNodes()) already collected every field via
    // inputFields before this ever runs, so there is nothing left for an
    // AI to interpret. userId (from this function's own new param, Wave 4)
    // is what makes createdById real instead of a system placeholder.
    case "crm_create_lead_engine": {
      const { createLead } = await import("@/lib/services/crm-service");
      const name = String(inputs.name ?? "").trim();
      if (!name) throw new Error("name is required");
      return createLead(
        { orgId, userId },
        {
          name,
          contactEmail: inputs.contactEmail ? String(inputs.contactEmail) : undefined,
          contactPhone: inputs.contactPhone ? String(inputs.contactPhone) : undefined,
          source: inputs.source ? String(inputs.source) : undefined,
        }
      );
    }
    case "crm_create_opportunity_engine": {
      const { createOpportunity } = await import("@/lib/services/crm-service");
      const name = String(inputs.name ?? "").trim();
      const leadId = String(inputs.leadId ?? "").trim();
      if (!name) throw new Error("name is required");
      if (!leadId) throw new Error("leadId is required");
      return createOpportunity(
        { orgId, userId },
        { name, leadId, estimatedValue: inputs.estimatedValue != null ? Number(inputs.estimatedValue) : undefined }
      );
    }
    case "crm_create_activity_engine": {
      const { createActivity } = await import("@/lib/services/crm-activities-service");
      const entityType = String(inputs.entityType ?? "");
      const entityId = String(inputs.entityId ?? "").trim();
      const activityType = String(inputs.activityType ?? "");
      const subject = String(inputs.subject ?? "").trim();
      if (!["lead", "opportunity", "account", "contact"].includes(entityType)) throw new Error("entityType must be lead, opportunity, account, or contact");
      if (!entityId) throw new Error("entityId is required");
      if (!["task", "meeting", "call"].includes(activityType)) throw new Error("activityType must be task, meeting, or call");
      if (!subject) throw new Error("subject is required");
      return createActivity(
        { orgId, userId },
        { entityType: entityType as "lead" | "opportunity" | "account" | "contact", entityId, activityType: activityType as "task" | "meeting" | "call", subject, dueDate: inputs.dueDate ? String(inputs.dueDate) : undefined }
      );
    }
    case "crm_create_campaign_engine": {
      const { createCampaign } = await import("@/lib/services/crm-campaigns-service");
      const name = String(inputs.name ?? "").trim();
      if (!name) throw new Error("name is required");
      return createCampaign({ orgId, userId }, { name, campaignType: inputs.campaignType ? String(inputs.campaignType) : undefined });
    }
    // Mathematical Computation Engine (10 of 13 -- see capability-tree-
    // service.ts's comment for the 3 deferred, matrix/model-input ones).
    case "basic_arithmetic_engine": {
      const { add, subtract, multiply, divide } = await import("@/lib/engines/mathematical-engine");
      const a = Number(inputs.a), b = Number(inputs.b);
      const fn = { add, subtract, multiply, divide }[String(inputs.operation)];
      if (!fn) throw new Error("Invalid operation");
      return { result: fn(a, b) };
    }
    case "scientific_calculator_engine": {
      const { evaluateExpression } = await import("@/lib/engines/mathematical-engine");
      return { result: evaluateExpression(String(inputs.expr ?? "")) };
    }
    case "financial_mathematics_engine": {
      const { presentValue, futureValue, compoundInterest } = await import("@/lib/engines/mathematical-engine");
      const amount = Number(inputs.amount), rate = Number(inputs.rate), periods = Number(inputs.periodsOrYears);
      switch (inputs.operation) {
        case "present_value": return { result: presentValue(amount, rate, periods) };
        case "future_value": return { result: futureValue(amount, rate, periods) };
        case "compound_interest": return { result: compoundInterest(amount, rate, Number(inputs.timesCompoundedPerYear) || 1, periods) };
        default: throw new Error("Invalid operation");
      }
    }
    case "percentage_engine": {
      const { percentageOf, percentageChange } = await import("@/lib/engines/mathematical-engine");
      const value1 = Number(inputs.value1), value2 = Number(inputs.value2);
      if (inputs.operation === "percentage_of") return { result: percentageOf(value1, value2) };
      if (inputs.operation === "percentage_change") return { result: percentageChange(value1, value2) };
      throw new Error("Invalid operation");
    }
    case "ratio_engine": {
      const { simplifyRatio } = await import("@/lib/engines/mathematical-engine");
      const [num, den] = simplifyRatio(Number(inputs.a), Number(inputs.b));
      return { numerator: num, denominator: den };
    }
    case "fraction_engine": {
      const { addFractions } = await import("@/lib/engines/mathematical-engine");
      const [num, den] = addFractions(Number(inputs.n1), Number(inputs.d1), Number(inputs.n2), Number(inputs.d2));
      return { numerator: num, denominator: den };
    }
    case "statistical_engine": {
      const { statisticalSummary } = await import("@/lib/engines/mathematical-engine");
      return statisticalSummary(parseNumberList(inputs.values));
    }
    case "probability_engine": {
      const { combinations, permutations, normalCdf } = await import("@/lib/engines/mathematical-engine");
      switch (inputs.operation) {
        case "combinations": return { result: combinations(Number(inputs.n), Number(inputs.k)) };
        case "permutations": return { result: permutations(Number(inputs.n), Number(inputs.k)) };
        case "normal_cdf": return { result: normalCdf(Number(inputs.n), inputs.k ? Number(inputs.k) : undefined, inputs.stdDev ? Number(inputs.stdDev) : undefined) };
        default: throw new Error("Invalid operation");
      }
    }
    case "regression_engine": {
      const { linearRegression } = await import("@/lib/engines/mathematical-engine");
      const xs = parseNumberList(inputs.xValues), ys = parseNumberList(inputs.yValues);
      if (xs.length !== ys.length || xs.length === 0) throw new Error("X and Y value lists must be the same non-zero length");
      const { slope, intercept } = linearRegression(xs.map((x, i) => [x, ys[i]] as [number, number]));
      return { slope, intercept };
    }
    case "time_series_engine": {
      const { movingAverage } = await import("@/lib/engines/mathematical-engine");
      return { movingAverage: movingAverage(parseNumberList(inputs.values), Number(inputs.windowSize)) };
    }
  }

  const gstSplitInput = () => ({
    taxableAmount: Number(inputs.taxableAmount),
    gstRatePercent: Number(inputs.gstRatePercent),
    supplierStateCode: String(inputs.supplierStateCode ?? ""),
    buyerStateCode: String(inputs.buyerStateCode ?? ""),
  });

  switch (engineKey) {
    // Costing Engine (8 of 8 registered engines) -- non-manufacturing
    // costing methods (job/contract/service costing, allocation, variance)
    // from costing-engine.ts. The two array-of-objects inputs
    // (activity_based_costing_engine's costPools/objectDriverUsage and
    // cost_allocation_engine's allocationBasis) are dispatch-only -- no UI
    // field type supports a grid/JSON-editor, the same skip pattern the
    // Mathematical Computation Engine's 3 matrix/model-input engines follow
    // above (see capability-tree-service.ts's COSTING_WIRED_ENGINE_INPUT_FIELDS
    // comment).
    case "job_costing_engine": {
      const { calculateJobCost } = await import("@/lib/engines/costing-engine");
      return { result: calculateJobCost(Number(inputs.directMaterial), Number(inputs.directLabor), Number(inputs.overheadAllocated)) };
    }
    case "standard_costing_engine": {
      const { standardCostingVariance } = await import("@/lib/engines/costing-engine");
      return standardCostingVariance({
        standardPrice: Number(inputs.standardPrice),
        actualPrice: Number(inputs.actualPrice),
        standardQuantity: Number(inputs.standardQuantity),
        actualQuantity: Number(inputs.actualQuantity),
      });
    }
    case "marginal_costing_engine": {
      const { marginalCostingAnalysis } = await import("@/lib/engines/costing-engine");
      return marginalCostingAnalysis({
        sellingPricePerUnit: Number(inputs.sellingPricePerUnit),
        variableCostPerUnit: Number(inputs.variableCostPerUnit),
        fixedCosts: Number(inputs.fixedCosts),
      });
    }
    case "activity_based_costing_engine": {
      const { allocateActivityBasedCost } = await import("@/lib/engines/costing-engine");
      const costPools = inputs.costPools;
      if (!Array.isArray(costPools)) throw new Error("costPools must be an array");
      const objectDriverUsage = inputs.objectDriverUsage;
      if (typeof objectDriverUsage !== "object" || objectDriverUsage === null || Array.isArray(objectDriverUsage)) {
        throw new Error("objectDriverUsage must be an object");
      }
      return allocateActivityBasedCost(
        costPools as { activity: string; totalCost: number; totalDriverUnits: number }[],
        objectDriverUsage as Record<string, number>,
      );
    }
    case "batch_costing_engine_2": {
      const { calculateBatchCost } = await import("@/lib/engines/costing-engine");
      return { result: calculateBatchCost(Number(inputs.totalBatchCost), Number(inputs.unitsInBatch)) };
    }
    case "service_costing_engine": {
      const { calculateServiceCost } = await import("@/lib/engines/costing-engine");
      return { result: calculateServiceCost(Number(inputs.directCost), Number(inputs.indirectCostAllocated), Number(inputs.serviceUnits)) };
    }
    case "cost_allocation_engine": {
      const { allocateCostPool } = await import("@/lib/engines/costing-engine");
      const allocationBasis = inputs.allocationBasis;
      if (!Array.isArray(allocationBasis)) throw new Error("allocationBasis must be an array");
      return allocateCostPool(Number(inputs.pool), allocationBasis as { id: string; basisValue: number }[]);
    }
    case "variance_analysis_engine": {
      const { analyzeVariance } = await import("@/lib/engines/costing-engine");
      const higherIsFavorable = inputs.higherIsFavorable == null || inputs.higherIsFavorable === ""
        ? true
        : truthy(inputs.higherIsFavorable);
      return analyzeVariance(Number(inputs.actual), Number(inputs.budget), higherIsFavorable);
    }
  }

  switch (engineKey) {
    // cgst/sgst/igst_engine are the same underlying split -- distinct
    // registry rows/labels, one real function (matches implementation_ref).
    case "gst_split_engine":
    case "cgst_engine":
    case "sgst_engine":
    case "igst_engine": {
      const { splitGst } = await import("@/lib/engines/in/gst-engine");
      return splitGst(gstSplitInput());
    }
    case "utgst_engine": {
      const { splitGstWithUtgst } = await import("@/lib/engines/in/gst-engine");
      return splitGstWithUtgst(gstSplitInput());
    }
    case "gst_calculation_engine": {
      const { calculateGst } = await import("@/lib/engines/in/gst-engine");
      return calculateGst(gstSplitInput());
    }
    case "reverse_charge_engine": {
      const { computeReverseChargeLiability } = await import("@/lib/engines/in/gst-engine");
      return computeReverseChargeLiability({ ...gstSplitInput(), isReverseCharge: truthy(inputs.isReverseCharge) });
    }
    case "hsn_validation_engine": {
      const { isValidHsnFormat } = await import("@/lib/engines/in/gst-engine");
      return { valid: isValidHsnFormat(String(inputs.hsn ?? "")) };
    }
    case "sac_validation_engine": {
      const { isValidSacFormat } = await import("@/lib/engines/in/gst-engine");
      return { valid: isValidSacFormat(String(inputs.sac ?? "")) };
    }
    case "eway_bill_validation_engine": {
      const { isValidEwayBillNumberFormat } = await import("@/lib/engines/in/gst-engine");
      return { valid: isValidEwayBillNumberFormat(String(inputs.ebn ?? "")) };
    }
    case "gst_exclusive_engine": {
      const { gstExclusiveToInclusive } = await import("@/lib/engines/in/gst-engine");
      return gstExclusiveToInclusive(Number(inputs.taxableAmount), Number(inputs.gstRatePercent));
    }
    case "gst_inclusive_engine": {
      const { gstInclusiveToTaxable } = await import("@/lib/engines/in/gst-engine");
      return gstInclusiveToTaxable(Number(inputs.inclusiveAmount), Number(inputs.gstRatePercent));
    }
    case "gst_interest_engine": {
      const { calculateGstInterest } = await import("@/lib/engines/in/gst-engine");
      return { interest: calculateGstInterest({
        taxAmount: Number(inputs.taxAmount), daysLate: Number(inputs.daysLate),
        isExcessItcClaim: inputs.isExcessItcClaim ? truthy(inputs.isExcessItcClaim) : undefined,
      }) };
    }
    case "gst_late_fee_engine": {
      const { calculateGstLateFee } = await import("@/lib/engines/in/gst-engine");
      return calculateGstLateFee({
        daysLate: Number(inputs.daysLate),
        isNilReturn: inputs.isNilReturn ? truthy(inputs.isNilReturn) : undefined,
      });
    }
    case "itc_calculation_engine": {
      const { calculateEligibleItc } = await import("@/lib/engines/in/gst-engine");
      return calculateEligibleItc({
        totalItcAvailable: Number(inputs.totalItcAvailable), blockedCreditAmount: Number(inputs.blockedCreditAmount),
        exemptSupplyRatio: inputs.exemptSupplyRatio ? Number(inputs.exemptSupplyRatio) : undefined,
      });
    }
  }

  // Income Tax Engine -- 9 of 9 registered engines wired (all already
  // `status: 'implemented'` in computation_engines; completes a second full
  // category alongside GST and Math). Slab rates are statutory data isolated
  // in income-tax-engine.ts itself, not duplicated here.
  switch (engineKey) {
    case "income_tax_calculator": {
      const { calculateIncomeTax } = await import("@/lib/engines/in/income-tax-engine");
      return calculateIncomeTax(Number(inputs.taxableIncome));
    }
    case "advance_tax_calculator": {
      const { calculateAdvanceTaxInstallment } = await import("@/lib/engines/in/income-tax-engine");
      const quarter = String(inputs.quarter ?? "");
      if (!["q1", "q2", "q3", "q4"].includes(quarter)) throw new Error("quarter must be one of q1, q2, q3, q4");
      return { installmentDue: calculateAdvanceTaxInstallment(Number(inputs.estimatedAnnualTax), quarter as "q1" | "q2" | "q3" | "q4", Number(inputs.alreadyPaid)) };
    }
    case "self_assessment_tax_calculator": {
      const { calculateSelfAssessmentTax } = await import("@/lib/engines/in/income-tax-engine");
      return { balanceDue: calculateSelfAssessmentTax(Number(inputs.totalTaxLiability), Number(inputs.tdsDeducted), Number(inputs.advanceTaxPaid), inputs.interestDue ? Number(inputs.interestDue) : undefined) };
    }
    case "income_tax_interest_calculator": {
      const { calculateIncomeTaxInterest } = await import("@/lib/engines/in/income-tax-engine");
      const section = inputs.section ? String(inputs.section) : "234B";
      if (!["234A", "234B", "234C"].includes(section)) throw new Error("section must be one of 234A, 234B, 234C");
      return { interest: calculateIncomeTaxInterest(Number(inputs.unpaidAmount), Number(inputs.monthsDelayed), section as "234A" | "234B" | "234C") };
    }
    case "income_tax_penalty_calculator": {
      const { calculateLateFilingPenalty } = await import("@/lib/engines/in/income-tax-engine");
      return { penalty: calculateLateFilingPenalty(Number(inputs.totalIncome), truthy(inputs.filedAfterDueDate)) };
    }
    case "capital_gains_calculator": {
      const { calculateCapitalGains } = await import("@/lib/engines/in/income-tax-engine");
      const assetType = inputs.assetType ? String(inputs.assetType) : undefined;
      if (assetType && !["equity", "other"].includes(assetType)) throw new Error("assetType must be equity or other");
      return calculateCapitalGains({
        saleValue: Number(inputs.saleValue), costOfAcquisition: Number(inputs.costOfAcquisition),
        costOfImprovement: inputs.costOfImprovement ? Number(inputs.costOfImprovement) : undefined,
        expensesOnTransfer: inputs.expensesOnTransfer ? Number(inputs.expensesOnTransfer) : undefined,
        isLongTerm: truthy(inputs.isLongTerm), assetType: assetType as "equity" | "other" | undefined,
      });
    }
    case "indexation_calculator": {
      const { calculateIndexedCost } = await import("@/lib/engines/in/income-tax-engine");
      return { indexedCost: calculateIndexedCost(Number(inputs.originalCost), Number(inputs.costInflationIndexAtPurchase), Number(inputs.costInflationIndexAtSale)) };
    }
    case "mat_calculator": {
      const { calculateMat } = await import("@/lib/engines/in/income-tax-engine");
      return calculateMat(Number(inputs.bookProfit), Number(inputs.normalTaxLiability));
    }
    case "amt_calculator": {
      const { calculateAmt } = await import("@/lib/engines/in/income-tax-engine");
      return calculateAmt(Number(inputs.adjustedTotalIncome), Number(inputs.normalTaxLiability));
    }
  }

  // TDS/TCS Engine (tree4-unified/50-completion-plan PLAN-18 batch 2, Wave
  // 165) -- 6 of 7 registered engines (tds_calculator deliberately deferred,
  // see capability-tree-service.ts's comment for why). Statutory section
  // rates isolated in tds-engine.ts itself, not duplicated here.
  switch (engineKey) {
    case "tcs_calculator": {
      const { calculateTcs } = await import("@/lib/engines/in/tds-engine");
      return calculateTcs(Number(inputs.saleValue), Number(inputs.ratePercent), inputs.thresholdAmount ? Number(inputs.thresholdAmount) : undefined);
    }
    case "tds_threshold_checker": {
      const { isTdsApplicable } = await import("@/lib/engines/in/tds-engine");
      return { applicable: isTdsApplicable(String(inputs.section ?? ""), Number(inputs.cumulativePaymentAmount)) };
    }
    case "tds_section_validation_engine": {
      const { computeTdsForSection } = await import("@/lib/engines/in/tds-engine");
      return computeTdsForSection(String(inputs.section ?? ""), Number(inputs.paymentAmount), Number(inputs.cumulativePaymentAmount), inputs.hasPan === undefined ? true : truthy(inputs.hasPan));
    }
    case "tds_interest_engine": {
      const { calculateTdsInterest } = await import("@/lib/engines/in/tds-engine");
      const delayType = String(inputs.delayType ?? "");
      if (!["late_deduction", "late_deposit"].includes(delayType)) throw new Error("delayType must be late_deduction or late_deposit");
      return { interest: calculateTdsInterest(Number(inputs.tdsAmount), Number(inputs.monthsDelayed), delayType as "late_deduction" | "late_deposit") };
    }
    case "challan_matching_engine": {
      const { matchTdsChallans } = await import("@/lib/engines/in/tds-engine");
      const deductions = inputs.deductions as { id: string; period: string; amount: number }[];
      const challans = inputs.challans as { id: string; period: string; amount: number }[];
      if (!Array.isArray(deductions) || !Array.isArray(challans)) throw new Error("deductions and challans must both be arrays");
      return matchTdsChallans(deductions, challans);
    }
    case "pan_validation_engine": {
      const { isValidPanFormat } = await import("@/lib/engines/data-quality-engine");
      return { valid: isValidPanFormat(String(inputs.pan ?? "")) };
    }
  }

  // Accounting Computation Engine (tree4-unified/50-completion-plan area 8,
  // Wave 167) -- 11 of 20 registered engines. The other 9
  // (double_entry_engine, journal_posting_engine, ledger_posting_engine,
  // trial_balance_engine, profit_loss_engine, balance_sheet_engine,
  // cash_flow_engine, financial_year_closing_engine, chart_of_accounts_engine)
  // are already implemented in erp-accounting-service.ts/erp-financial-
  // report-service.ts as real, DB-backed ERP product functions (per
  // accounting-engine.ts's own header comment) -- deliberately NOT
  // re-dispatched here as a second surface; see this session's log for why.
  switch (engineKey) {
    case "opening_balance_engine": {
      const { computeOpeningBalance } = await import("@/lib/engines/accounting-engine");
      return { openingBalance: computeOpeningBalance(Number(inputs.priorClosingBalance)) };
    }
    case "closing_balance_engine": {
      const { computeClosingBalance } = await import("@/lib/engines/accounting-engine");
      return { closingBalance: computeClosingBalance(Number(inputs.openingBalance), Number(inputs.totalDebits), Number(inputs.totalCredits), truthy(inputs.isDebitNormal)) };
    }
    case "balance_verification_engine": {
      // AI Architecture / Explainability & Transparency gap-closure
      // (2026-07-18): the *Explained() variant -- see accounting-engine.ts's
      // header comment. Safe here specifically because this dispatch's
      // return value is only ever JSON.stringify'd into a task chat message
      // (executeEngineDispatch, below) and sanity-checked by
      // assertValidDispatchOutput (tolerates any nested shape, only rejects
      // NaN/Infinity numbers) -- adding fields doesn't break either.
      const { verifyBalancesNetToZeroExplained } = await import("@/lib/engines/accounting-engine");
      const balances = inputs.balances as { accountId: string; debit: number; credit: number }[];
      if (!Array.isArray(balances)) throw new Error("balances must be an array");
      return verifyBalancesNetToZeroExplained(balances);
    }
    case "consolidation_engine": {
      const { consolidateBalances } = await import("@/lib/engines/accounting-engine");
      const entityBalances = inputs.entityBalances as { entityId: string; accountId: string; amount: number }[];
      const intercompanyAccountIds = inputs.intercompanyAccountIds as string[];
      if (!Array.isArray(entityBalances) || !Array.isArray(intercompanyAccountIds)) throw new Error("entityBalances and intercompanyAccountIds must both be arrays");
      return consolidateBalances(entityBalances, intercompanyAccountIds);
    }
    case "fund_flow_engine": {
      const { computeFundFlow } = await import("@/lib/engines/accounting-engine");
      return computeFundFlow(Number(inputs.openingWorkingCapital), Number(inputs.closingWorkingCapital));
    }
    case "statement_changes_equity_engine": {
      const { statementOfChangesInEquity } = await import("@/lib/engines/accounting-engine");
      return statementOfChangesInEquity({
        openingBalance: Number(inputs.openingBalance), profitForPeriod: Number(inputs.profitForPeriod),
        dividendsPaid: inputs.dividendsPaid ? Number(inputs.dividendsPaid) : undefined,
        capitalIntroduced: inputs.capitalIntroduced ? Number(inputs.capitalIntroduced) : undefined,
        otherComprehensiveIncome: inputs.otherComprehensiveIncome ? Number(inputs.otherComprehensiveIncome) : undefined,
      });
    }
    case "notes_to_accounts_generator": {
      const { generateNotesToAccounts } = await import("@/lib/engines/accounting-engine");
      const lineItems = inputs.lineItems as { accountId: string; noteCategory: string; amount: number }[];
      if (!Array.isArray(lineItems)) throw new Error("lineItems must be an array");
      return generateNotesToAccounts(lineItems);
    }
    case "voucher_validation_engine": {
      const { validateVoucher } = await import("@/lib/engines/accounting-engine");
      const lines = inputs.lines as { accountId: string }[];
      if (!Array.isArray(lines)) throw new Error("lines must be an array");
      return validateVoucher({ debitTotal: Number(inputs.debitTotal), creditTotal: Number(inputs.creditTotal), lines });
    }
    case "duplicate_entry_detection_engine": {
      const { detectDuplicateEntries } = await import("@/lib/engines/accounting-engine");
      const entries = inputs.entries as { id: string; date: string; amount: number; accountId: string; reference?: string }[];
      if (!Array.isArray(entries)) throw new Error("entries must be an array");
      return { duplicateGroups: detectDuplicateEntries(entries) };
    }
    case "suspense_account_detection_engine": {
      const { detectSuspenseAccountBalance } = await import("@/lib/engines/accounting-engine");
      return detectSuspenseAccountBalance(Number(inputs.suspenseAccountBalance));
    }
    case "ledger_reconciliation_engine": {
      const { reconcileLedgers } = await import("@/lib/engines/accounting-engine");
      const ledgerA = inputs.ledgerA as { reference: string; amount: number }[];
      const ledgerB = inputs.ledgerB as { reference: string; amount: number }[];
      if (!Array.isArray(ledgerA) || !Array.isArray(ledgerB)) throw new Error("ledgerA and ledgerB must both be arrays");
      return reconcileLedgers(ledgerA, ledgerB);
    }
  }

  // Payroll Engine (tree4-unified/50-completion-plan area 8, Wave 167) --
  // 14 of 18 registered engines. pf_calculator/esi_calculator/
  // professional_tax_calculator (findActiveRule-driven, admin-editable
  // statutory rules in a DB table) and salary_calculator (the whole
  // payroll-run computation) are NOT standalone pure functions -- same
  // deferred-for-DB-adapter situation as tds_calculator, see this
  // session's log for why they're not force-fit here.
  switch (engineKey) {
    case "gratuity_calculator": {
      const { calculateGratuity } = await import("@/lib/engines/payroll-engine");
      const gratuityInput = {
        lastDrawnMonthlySalary: Number(inputs.lastDrawnMonthlySalary), yearsOfService: Number(inputs.yearsOfService),
        isCoveredUnderAct: inputs.isCoveredUnderAct === undefined ? true : truthy(inputs.isCoveredUnderAct),
      };
      const gratuityResult = calculateGratuity(gratuityInput);
      assertCalculationVerified(crossVerifyGratuity(gratuityInput, gratuityResult), "Gratuity calculation");
      return gratuityResult;
    }
    case "eps_calculator": {
      const { calculateEps } = await import("@/lib/engines/payroll-engine");
      return { epsAmount: calculateEps(Number(inputs.monthlyBasicPlusDa)) };
    }
    case "labour_welfare_fund_calculator": {
      const { calculateLwf } = await import("@/lib/engines/payroll-engine");
      return calculateLwf(Number(inputs.employeeContribution), Number(inputs.employerContribution));
    }
    case "bonus_calculator": {
      const { calculateBonus } = await import("@/lib/engines/payroll-engine");
      return { bonusAmount: calculateBonus(Number(inputs.annualBasicPlusDa), Number(inputs.bonusPercent)) };
    }
    case "incentive_calculator": {
      const { calculateIncentive } = await import("@/lib/engines/payroll-engine");
      const incentiveSlabs = inputs.incentiveSlabs as { minAchievementPercent: number; incentivePercentOfTarget: number }[];
      if (!Array.isArray(incentiveSlabs)) throw new Error("incentiveSlabs must be an array");
      return { incentiveAmount: calculateIncentive(Number(inputs.achievedValue), Number(inputs.targetValue), incentiveSlabs) };
    }
    case "commission_calculator": {
      const { calculatePayrollCommission } = await import("@/lib/engines/payroll-engine");
      return { commissionAmount: calculatePayrollCommission(Number(inputs.saleAmount), Number(inputs.commissionRatePercent)) };
    }
    case "overtime_calculator": {
      const { calculateOvertime } = await import("@/lib/engines/payroll-engine");
      return { overtimeAmount: calculateOvertime(Number(inputs.monthlyBasicPlusDa), Number(inputs.standardMonthlyHours), Number(inputs.overtimeHours), inputs.multiplier ? Number(inputs.multiplier) : undefined) };
    }
    case "shift_allowance_calculator": {
      const { calculateShiftAllowance } = await import("@/lib/engines/payroll-engine");
      return { allowanceAmount: calculateShiftAllowance(Number(inputs.shiftDays), Number(inputs.allowancePerShift)) };
    }
    case "leave_encashment_calculator": {
      const { calculateLeaveEncashment } = await import("@/lib/engines/payroll-engine");
      return { encashmentAmount: calculateLeaveEncashment(Number(inputs.lastDrawnMonthlySalary), Number(inputs.unusedLeaveDays)) };
    }
    case "superannuation_calculator": {
      const { calculateSuperannuation } = await import("@/lib/engines/payroll-engine");
      return { superannuationAmount: calculateSuperannuation(Number(inputs.annualBasic), inputs.contributionPercent ? Number(inputs.contributionPercent) : undefined) };
    }
    case "full_final_settlement_calculator": {
      const { calculateFullAndFinalSettlement } = await import("@/lib/engines/payroll-engine");
      return { settlementAmount: calculateFullAndFinalSettlement({
        unpaidSalary: Number(inputs.unpaidSalary), leaveEncashment: Number(inputs.leaveEncashment),
        gratuity: inputs.gratuity ? Number(inputs.gratuity) : undefined, bonus: inputs.bonus ? Number(inputs.bonus) : undefined,
        recoveries: inputs.recoveries ? Number(inputs.recoveries) : undefined,
      }) };
    }
    case "arrear_calculator": {
      const { calculateArrears } = await import("@/lib/engines/payroll-engine");
      return { arrearAmount: calculateArrears(Number(inputs.revisedMonthlyPay), Number(inputs.originalMonthlyPay), Number(inputs.affectedMonths)) };
    }
    case "increment_calculator": {
      const { calculateIncrement } = await import("@/lib/engines/payroll-engine");
      return calculateIncrement(Number(inputs.currentSalary), Number(inputs.incrementPercent));
    }
    case "salary_revision_calculator": {
      const { calculateSalaryRevision } = await import("@/lib/engines/payroll-engine");
      const components = inputs.components as Record<string, number>;
      if (!components || typeof components !== "object" || Array.isArray(components)) throw new Error("components must be an object of {component: amount}");
      return calculateSalaryRevision(components, Number(inputs.revisionPercent));
    }
  }

  // Inventory Engine (tree4-unified/50-completion-plan area 8, Wave 168) --
  // 15 of 15 registered engines, full category complete.
  switch (engineKey) {
    case "fifo_engine": {
      const { consumeFifo } = await import("@/lib/engines/inventory-engine");
      const lots = inputs.lots as { quantity: number; unitCost: number; receivedDate?: string; expiryDate?: string }[];
      if (!Array.isArray(lots)) throw new Error("lots must be an array");
      return consumeFifo(lots, Number(inputs.quantityToConsume));
    }
    case "fefo_engine": {
      const { consumeFefo } = await import("@/lib/engines/inventory-engine");
      const lots = inputs.lots as { quantity: number; unitCost: number; receivedDate?: string; expiryDate?: string }[];
      if (!Array.isArray(lots)) throw new Error("lots must be an array");
      return consumeFefo(lots, Number(inputs.quantityToConsume));
    }
    case "weighted_average_engine": {
      const { weightedAverageCost } = await import("@/lib/engines/inventory-engine");
      const lots = inputs.lots as { quantity: number; unitCost: number }[];
      if (!Array.isArray(lots)) throw new Error("lots must be an array");
      return { weightedAverageCost: weightedAverageCost(lots) };
    }
    case "standard_cost_engine": {
      const { standardCostVariance } = await import("@/lib/engines/inventory-engine");
      return standardCostVariance(Number(inputs.actualCost), Number(inputs.standardCost), Number(inputs.quantity));
    }
    case "moving_average_engine": {
      const { movingAverageAfterReceipt } = await import("@/lib/engines/inventory-engine");
      return { newAverageCost: movingAverageAfterReceipt(Number(inputs.currentQty), Number(inputs.currentAvgCost), Number(inputs.receiptQty), Number(inputs.receiptCost)) };
    }
    case "stock_valuation_engine": {
      const { valueStock } = await import("@/lib/engines/inventory-engine");
      const lots = inputs.lots as { quantity: number; unitCost: number }[];
      if (!Array.isArray(lots)) throw new Error("lots must be an array");
      const method = inputs.method ? String(inputs.method) : undefined;
      if (method && !["fifo", "weighted_average"].includes(method)) throw new Error("method must be fifo or weighted_average");
      return { stockValue: valueStock(lots, method as "fifo" | "weighted_average" | undefined) };
    }
    case "inventory_aging_engine": {
      const { ageInventory } = await import("@/lib/engines/inventory-engine");
      const lots = inputs.lots as { quantity: number; unitCost: number; receivedDate: string }[];
      if (!Array.isArray(lots)) throw new Error("lots must be an array");
      const buckets = inputs.buckets as number[] | undefined;
      if (buckets !== undefined && !Array.isArray(buckets)) throw new Error("buckets must be an array of numbers if provided");
      return ageInventory(lots, String(inputs.asOfDate ?? ""), buckets);
    }
    case "eoq_calculator": {
      const { calculateEoq } = await import("@/lib/engines/inventory-engine");
      return { eoq: calculateEoq(Number(inputs.annualDemand), Number(inputs.orderingCostPerOrder), Number(inputs.holdingCostPerUnitPerYear)) };
    }
    case "reorder_level_calculator": {
      const { calculateReorderLevel } = await import("@/lib/engines/inventory-engine");
      return { reorderLevel: calculateReorderLevel(Number(inputs.avgDailyUsage), Number(inputs.leadTimeDays), Number(inputs.safetyStock)) };
    }
    case "safety_stock_calculator": {
      const { calculateSafetyStock } = await import("@/lib/engines/inventory-engine");
      return { safetyStock: calculateSafetyStock(Number(inputs.maxDailyUsage), Number(inputs.maxLeadTimeDays), Number(inputs.avgDailyUsage), Number(inputs.avgLeadTimeDays)) };
    }
    case "abc_analysis_engine": {
      const { abcAnalysis } = await import("@/lib/engines/inventory-engine");
      const items = inputs.items as { id: string; annualUsageValue: number }[];
      if (!Array.isArray(items)) throw new Error("items must be an array");
      return abcAnalysis(items);
    }
    case "xyz_analysis_engine": {
      const { xyzAnalysis } = await import("@/lib/engines/inventory-engine");
      const items = inputs.items as { id: string; demandHistory: number[] }[];
      if (!Array.isArray(items)) throw new Error("items must be an array");
      return xyzAnalysis(items);
    }
    case "slow_moving_inventory_engine": {
      const { findSlowMovingItems } = await import("@/lib/engines/inventory-engine");
      const items = inputs.items as { id: string; quantityOnHand: number; quantityConsumedInWindow: number }[];
      if (!Array.isArray(items)) throw new Error("items must be an array");
      return { slowMovingItemIds: findSlowMovingItems(items, inputs.thresholdTurnoverRatio ? Number(inputs.thresholdTurnoverRatio) : undefined) };
    }
    case "dead_stock_engine": {
      const { findDeadStock } = await import("@/lib/engines/inventory-engine");
      const items = inputs.items as { id: string; quantityOnHand: number; quantityConsumedInWindow: number }[];
      if (!Array.isArray(items)) throw new Error("items must be an array");
      return { deadStockItemIds: findDeadStock(items) };
    }
    case "cycle_counting_engine": {
      const { suggestCycleCountSchedule } = await import("@/lib/engines/inventory-engine");
      const abcClass = String(inputs.abcClass ?? "");
      if (!["A", "B", "C"].includes(abcClass)) throw new Error("abcClass must be A, B, or C");
      return suggestCycleCountSchedule(abcClass as "A" | "B" | "C");
    }
  }

  // HR Engine (tree4-unified/50-completion-plan area 8, Wave 168) -- 9 of 9
  // registered engines, full category complete.
  switch (engineKey) {
    case "attendance_calculator": {
      const { calculateAttendancePercent } = await import("@/lib/engines/hr-engine");
      return { attendancePercent: calculateAttendancePercent(Number(inputs.presentDays), Number(inputs.totalWorkingDays)) };
    }
    case "leave_balance_engine": {
      const { calculateLeaveBalance } = await import("@/lib/engines/hr-engine");
      return { leaveBalance: calculateLeaveBalance(Number(inputs.openingBalance), Number(inputs.accrued), Number(inputs.taken)) };
    }
    case "shift_planner": {
      const { planShifts } = await import("@/lib/engines/hr-engine");
      const employeeIds = inputs.employeeIds as string[];
      const shifts = inputs.shifts as { name: string; capacity: number }[];
      if (!Array.isArray(employeeIds) || !Array.isArray(shifts)) throw new Error("employeeIds and shifts must both be arrays");
      return planShifts(employeeIds, shifts);
    }
    case "roster_engine": {
      const { buildRoster } = await import("@/lib/engines/hr-engine");
      const employeeIds = inputs.employeeIds as string[];
      const dates = inputs.dates as string[];
      const rotationPattern = inputs.rotationPattern as string[];
      if (!Array.isArray(employeeIds) || !Array.isArray(dates) || !Array.isArray(rotationPattern)) throw new Error("employeeIds, dates, and rotationPattern must all be arrays");
      return buildRoster(employeeIds, dates, rotationPattern);
    }
    case "experience_calculator": {
      const { calculateExperienceYears } = await import("@/lib/engines/hr-engine");
      return { experienceYears: calculateExperienceYears(String(inputs.fromDate ?? ""), String(inputs.toDate ?? "")) };
    }
    case "notice_period_calculator": {
      const { calculateNoticePeriodEnd } = await import("@/lib/engines/hr-engine");
      return { noticePeriodEndDate: calculateNoticePeriodEnd(String(inputs.resignationDate ?? ""), Number(inputs.noticePeriodDays)) };
    }
    case "probation_calculator": {
      const { calculateProbationEnd } = await import("@/lib/engines/hr-engine");
      return { probationEndDate: calculateProbationEnd(String(inputs.joiningDate ?? ""), Number(inputs.probationMonths)) };
    }
    case "performance_score_calculator": {
      const { calculatePerformanceScore } = await import("@/lib/engines/hr-engine");
      const ratings = inputs.ratings as { competency: string; score: number; weight: number }[];
      if (!Array.isArray(ratings)) throw new Error("ratings must be an array");
      return { performanceScore: calculatePerformanceScore(ratings) };
    }
    case "attrition_calculator": {
      const { calculateAttritionRate } = await import("@/lib/engines/hr-engine");
      return { attritionRatePercent: calculateAttritionRate(Number(inputs.separations), Number(inputs.openingHeadcount), Number(inputs.closingHeadcount)) };
    }
  }

  // Banking Engine (tree4-unified/50-completion-plan area 8, Wave 168) --
  // 8 of 9 registered engines. bank_reconciliation_engine is a real,
  // DB-backed ERP service (suggestMatches/matchLine in erp-bank-
  // reconciliation-service.ts), not a pure calculator -- deferred, same
  // reasoning as the other already-real-service deferrals this session.
  // emi_calculator/loan_schedule_generator/amortization_engine are 3 DB
  // registry keys for the SAME computation -- calculateEmi() already
  // returns the full month-by-month amortization schedule.
  switch (engineKey) {
    case "emi_calculator":
    case "loan_schedule_generator":
    case "amortization_engine": {
      const { calculateEmi } = await import("@/lib/engines/banking-engine");
      const emiInput = { principal: Number(inputs.principal), annualRatePercent: Number(inputs.annualRatePercent), tenureMonths: Number(inputs.tenureMonths) };
      const emiResult = calculateEmi(emiInput);
      assertCalculationVerified(crossVerifyEmi(emiInput, emiResult), "EMI/amortization calculation");
      return emiResult;
    }
    case "banking_interest_calculator": {
      const { calculateBankingInterest } = await import("@/lib/engines/banking-engine");
      const method = inputs.method ? String(inputs.method) : undefined;
      if (method && !["simple", "compound_daily"].includes(method)) throw new Error("method must be simple or compound_daily");
      return { interest: calculateBankingInterest(Number(inputs.principal), Number(inputs.annualRatePercent), Number(inputs.days), method as "simple" | "compound_daily" | undefined) };
    }
    case "cash_flow_projection": {
      const { projectCashFlow } = await import("@/lib/engines/banking-engine");
      const movements = inputs.movements as { date: string; amount: number }[];
      if (!Array.isArray(movements)) throw new Error("movements must be an array");
      return { projection: projectCashFlow(Number(inputs.openingBalance), movements) };
    }
    case "outstanding_cheque_engine": {
      const { findOutstandingCheques } = await import("@/lib/engines/banking-engine");
      const cheques = inputs.cheques as { id: string; issueDate: string; clearedDate?: string }[];
      if (!Array.isArray(cheques)) throw new Error("cheques must be an array");
      return { outstandingChequeIds: findOutstandingCheques(cheques, String(inputs.asOfDate ?? "")) };
    }
    case "deposit_maturity_engine": {
      const { calculateDepositMaturity } = await import("@/lib/engines/banking-engine");
      return calculateDepositMaturity(Number(inputs.principal), Number(inputs.annualRatePercent), Number(inputs.tenureMonths), inputs.compoundingFrequencyPerYear ? Number(inputs.compoundingFrequencyPerYear) : undefined);
    }
    case "credit_limit_calculator": {
      const { calculateCreditLimit } = await import("@/lib/engines/banking-engine");
      return { creditLimit: calculateCreditLimit(Number(inputs.monthlyIncome), Number(inputs.multiplier), inputs.existingMonthlyObligations ? Number(inputs.existingMonthlyObligations) : undefined) };
    }
  }

  // Procurement Engine (tree4-unified/50-completion-plan area 8, Wave 169)
  // -- 7 of 7 registered engines, full category complete.
  switch (engineKey) {
    case "purchase_cost_calculator": {
      const { calculatePurchaseCost } = await import("@/lib/engines/procurement-engine");
      return { purchaseCost: calculatePurchaseCost(Number(inputs.unitPrice), Number(inputs.quantity), inputs.otherCharges ? Number(inputs.otherCharges) : undefined) };
    }
    case "vendor_comparison_engine": {
      const { rankVendors } = await import("@/lib/engines/procurement-engine");
      const vendors = inputs.vendors as { vendorId: string; priceScore: number; qualityScore: number; deliveryScore: number }[];
      if (!Array.isArray(vendors)) throw new Error("vendors must be an array");
      const weights = inputs.weights as { price: number; quality: number; delivery: number } | undefined;
      return rankVendors(vendors, weights);
    }
    case "bid_evaluation_engine": {
      const { evaluateBids } = await import("@/lib/engines/procurement-engine");
      const bids = inputs.bids as { bidderId: string; price: number; technicalScore: number }[];
      if (!Array.isArray(bids)) throw new Error("bids must be an array");
      return evaluateBids(bids, Number(inputs.minTechnicalScore));
    }
    case "purchase_price_variance_engine": {
      const { calculatePurchasePriceVariance } = await import("@/lib/engines/procurement-engine");
      return calculatePurchasePriceVariance(Number(inputs.standardPrice), Number(inputs.actualPrice), Number(inputs.quantity));
    }
    case "landed_cost_engine": {
      const { calculateLandedCost } = await import("@/lib/engines/procurement-engine");
      return calculateLandedCost({
        purchaseCost: Number(inputs.purchaseCost), freight: Number(inputs.freight),
        insurance: inputs.insurance ? Number(inputs.insurance) : undefined,
        customsDuty: inputs.customsDuty ? Number(inputs.customsDuty) : undefined,
        otherCharges: inputs.otherCharges ? Number(inputs.otherCharges) : undefined,
        quantity: Number(inputs.quantity),
      });
    }
    case "freight_allocation_engine": {
      const { allocateFreight } = await import("@/lib/engines/procurement-engine");
      const lineItems = inputs.lineItems as { id: string; weight?: number; value?: number }[];
      if (!Array.isArray(lineItems)) throw new Error("lineItems must be an array");
      const basis = inputs.basis ? String(inputs.basis) : undefined;
      if (basis && !["weight", "value"].includes(basis)) throw new Error("basis must be weight or value");
      return allocateFreight(lineItems, Number(inputs.totalFreightCost), basis as "weight" | "value" | undefined);
    }
    case "moq_optimizer": {
      const { optimizeForMoq } = await import("@/lib/engines/procurement-engine");
      return { optimizedQuantity: optimizeForMoq(Number(inputs.requiredQuantity), Number(inputs.moq), inputs.orderMultiple ? Number(inputs.orderMultiple) : undefined) };
    }
  }

  // Security Engine (tree4-unified/50-completion-plan area 8, Wave 169) --
  // 3 of 7 registered engines. encryption_engine/decryption_engine map to
  // ai-config-crypto.ts's encryptApiKey/decryptApiKey, which are narrowly
  // scoped to `ai_configurations.encrypted_api_key` (BYOK storage) via a
  // specific pgcrypto key -- not a general-purpose arbitrary-plaintext VCEL
  // engine; force-fitting them here would be misleading about what they
  // actually protect. mfa_validation_engine/session_validation_engine have
  // no standalone pure function anywhere (session validation IS auth-
  // guard.ts's requireAuth(), which needs a live Supabase session/request,
  // not simple scalar inputs; no MFA validator function was found at all).
  // All 4 deferred, documented rather than force-fit.
  switch (engineKey) {
    case "hash_generation_engine": {
      const { generateHash, generateHmac } = await import("@/lib/engines/security-engine");
      const algorithm = inputs.algorithm ? String(inputs.algorithm) : undefined;
      if (algorithm && !["sha256", "sha512"].includes(algorithm)) throw new Error("algorithm must be sha256 or sha512");
      if (inputs.secret) return { hmac: generateHmac(String(inputs.input ?? ""), String(inputs.secret), algorithm as "sha256" | "sha512" | undefined) };
      return { hash: generateHash(String(inputs.input ?? ""), algorithm as "sha256" | "sha512" | undefined) };
    }
    case "digital_signature_engine": {
      const { signData, verifySignature } = await import("@/lib/engines/security-engine");
      if (inputs.mode === "verify") {
        return { valid: verifySignature(String(inputs.data ?? ""), String(inputs.signatureHex ?? ""), String(inputs.publicKeyPem ?? "")) };
      }
      return { signatureHex: signData(String(inputs.data ?? ""), String(inputs.privateKeyPem ?? "")) };
    }
    case "access_control_evaluation_engine": {
      const { isToolAllowedForDomain } = await import("@/lib/purpose-bound-ai");
      return { allowed: isToolAllowedForDomain(inputs.domain ? String(inputs.domain) : null, inputs.codeReference ? String(inputs.codeReference) : null) };
    }
  }

  // Audit Engine (tree4-unified/50-completion-plan area 8, Wave 169) -- 7
  // of 7 registered engines, full category complete.
  switch (engineKey) {
    case "materiality_calculator": {
      const { calculateMateriality } = await import("@/lib/engines/audit-engine");
      const baseType = String(inputs.baseType ?? "");
      if (!["revenue", "net_profit", "total_assets"].includes(baseType)) throw new Error("baseType must be revenue, net_profit, or total_assets");
      return { materiality: calculateMateriality(Number(inputs.baseAmount), baseType as "revenue" | "net_profit" | "total_assets") };
    }
    case "risk_scoring_engine": {
      const { calculateRiskScore } = await import("@/lib/engines/audit-engine");
      const factors = inputs.factors as { name: string; score: number; weight: number }[];
      if (!Array.isArray(factors)) throw new Error("factors must be an array");
      return { riskScore: calculateRiskScore(factors) };
    }
    case "duplicate_invoice_detector": {
      const { detectDuplicateInvoices } = await import("@/lib/engines/audit-engine");
      const invoices = inputs.invoices as { id: string; vendorId: string; invoiceNumber: string; amount: number }[];
      if (!Array.isArray(invoices)) throw new Error("invoices must be an array");
      return { duplicateGroups: detectDuplicateInvoices(invoices) };
    }
    case "duplicate_payment_detector": {
      const { detectDuplicatePayments } = await import("@/lib/engines/audit-engine");
      const payments = inputs.payments as { id: string; payeeId: string; amount: number; date: string }[];
      if (!Array.isArray(payments)) throw new Error("payments must be an array");
      return { duplicateGroups: detectDuplicatePayments(payments) };
    }
    case "journal_risk_analyzer": {
      const { analyzeJournalRisk } = await import("@/lib/engines/audit-engine");
      return analyzeJournalRisk({
        amount: Number(inputs.amount), postedAt: String(inputs.postedAt ?? ""),
        isManual: truthy(inputs.isManual), periodEndDate: String(inputs.periodEndDate ?? ""),
      });
    }
    case "benford_analysis_engine": {
      const { benfordAnalysis } = await import("@/lib/engines/audit-engine");
      const values = inputs.values as number[];
      if (!Array.isArray(values)) throw new Error("values must be an array of numbers");
      return benfordAnalysis(values.map(Number));
    }
    case "exception_detection_engine": {
      const { detectExceptions } = await import("@/lib/engines/audit-engine");
      const values = inputs.values as number[];
      if (!Array.isArray(values)) throw new Error("values must be an array of numbers");
      return { exceptions: detectExceptions(values.map(Number), inputs.zScoreThreshold ? Number(inputs.zScoreThreshold) : undefined) };
    }
  }

  // AI Support Engine (tree4-unified/50-completion-plan area 8, Wave 169)
  // -- 2 of 7 registered engines. context_compressor_engine/
  // cost_estimator_engine/prompt_compiler_engine/response_validator_engine/
  // semantic_cache_engine are, per ai-support-engine.ts's own header
  // comment, already real infrastructure deeply embedded in prompt-os-
  // resolver.ts/embeddings.ts/llm-client.ts/ai-workforce-agent.mjs rather
  // than standalone pure functions -- deferred, same reasoning as every
  // other already-real-elsewhere deferral this session.
  switch (engineKey) {
    case "tool_selector_engine": {
      const { selectTool } = await import("@/lib/engines/ai-support-engine");
      const availableTools = inputs.availableTools as string[];
      if (!Array.isArray(availableTools)) throw new Error("availableTools must be an array");
      return { selectedTool: selectTool(String(inputs.requestedCapability ?? ""), availableTools) };
    }
    case "context_deduplicator_engine": {
      const { deduplicateContextLines } = await import("@/lib/engines/ai-support-engine");
      const lines = inputs.lines as string[];
      if (!Array.isArray(lines)) throw new Error("lines must be an array of strings");
      return { deduplicatedLines: deduplicateContextLines(lines) };
    }
  }

  // Compliance Engine (tree4-unified/50-completion-plan area 8, Wave 169)
  // -- 4 of 6 registered engines. due_date_calculator/
  // compliance_calendar_engine are already implemented as core product
  // features (compliance-service.ts), not standalone pure functions here.
  switch (engineKey) {
    case "compliance_interest_calculator": {
      const { calculateComplianceInterest } = await import("@/lib/engines/compliance-engine");
      return { interest: calculateComplianceInterest(Number(inputs.amount), Number(inputs.annualRatePercent), Number(inputs.daysLate)) };
    }
    case "filing_eligibility_engine": {
      const { checkFilingEligibility } = await import("@/lib/engines/compliance-engine");
      const preconditions = inputs.preconditions as { name: string; met: boolean }[];
      if (!Array.isArray(preconditions)) throw new Error("preconditions must be an array");
      return checkFilingEligibility(preconditions);
    }
    case "document_completeness_checker": {
      const { checkDocumentCompleteness } = await import("@/lib/engines/compliance-engine");
      const requiredDocuments = inputs.requiredDocuments as string[];
      const filedDocuments = inputs.filedDocuments as string[];
      if (!Array.isArray(requiredDocuments) || !Array.isArray(filedDocuments)) throw new Error("requiredDocuments and filedDocuments must both be arrays");
      return checkDocumentCompleteness(requiredDocuments, filedDocuments);
    }
    case "compliance_risk_scoring": {
      const { calculateComplianceRiskScore } = await import("@/lib/engines/compliance-engine");
      return { riskScore: calculateComplianceRiskScore({
        overdueItemsCount: Number(inputs.overdueItemsCount), pastPenaltiesCount: Number(inputs.pastPenaltiesCount), totalItemsCount: Number(inputs.totalItemsCount),
      }) };
    }
  }

  // Analytics Engine (tree4-unified/50-completion-plan area 8, Wave 169)
  // -- 6 of 6 registered engines, full category complete. anomaly_detection_
  // engine supports both of the file's two detection methods (z-score,
  // the registry's own recommended default, and IQR) via a `method` input.
  switch (engineKey) {
    case "trend_analysis_engine": {
      // AI Architecture / Explainability & Transparency gap-closure
      // (2026-07-18): same *Explained() wiring rationale as
      // balance_verification_engine above.
      const { analyzeTrendExplained } = await import("@/lib/engines/analytics-engine");
      const values = inputs.values as number[];
      if (!Array.isArray(values)) throw new Error("values must be an array of numbers");
      return analyzeTrendExplained(values.map(Number));
    }
    case "analytics_variance_engine": {
      const { analyzeAnalyticsVariance } = await import("@/lib/engines/analytics-engine");
      return analyzeAnalyticsVariance(Number(inputs.actual), Number(inputs.expected));
    }
    case "benchmark_comparison_engine": {
      const { compareToBenchmark } = await import("@/lib/engines/analytics-engine");
      return compareToBenchmark(Number(inputs.actualValue), Number(inputs.benchmarkValue));
    }
    case "forecast_baseline_engine": {
      const { forecastBaseline } = await import("@/lib/engines/analytics-engine");
      const historicalValues = inputs.historicalValues as number[];
      if (!Array.isArray(historicalValues)) throw new Error("historicalValues must be an array of numbers");
      const method = inputs.method ? String(inputs.method) : undefined;
      if (method && !["naive", "moving_average"].includes(method)) throw new Error("method must be naive or moving_average");
      return { forecast: forecastBaseline(historicalValues.map(Number), method as "naive" | "moving_average" | undefined, inputs.windowSize ? Number(inputs.windowSize) : undefined) };
    }
    case "anomaly_detection_engine": {
      const { detectAnomaliesZScore, detectAnomaliesIqr } = await import("@/lib/engines/analytics-engine");
      const values = inputs.values as number[];
      if (!Array.isArray(values)) throw new Error("values must be an array of numbers");
      const method = inputs.method ? String(inputs.method) : "zscore";
      if (!["zscore", "iqr"].includes(method)) throw new Error("method must be zscore or iqr");
      const anomalies = method === "iqr" ? detectAnomaliesIqr(values.map(Number)) : detectAnomaliesZScore(values.map(Number), inputs.threshold ? Number(inputs.threshold) : undefined);
      return { anomalies };
    }
    case "correlation_calculator": {
      const { calculateCorrelation } = await import("@/lib/engines/analytics-engine");
      const xValues = inputs.xValues as number[];
      const yValues = inputs.yValues as number[];
      if (!Array.isArray(xValues) || !Array.isArray(yValues)) throw new Error("xValues and yValues must both be arrays");
      return { correlation: calculateCorrelation(xValues.map(Number), yValues.map(Number)) };
    }
  }

  // Logistics Engine (tree4-unified/50-completion-plan area 8, Wave 169)
  // -- 6 of 6 registered engines, full category complete.
  switch (engineKey) {
    case "route_optimization_engine": {
      const { optimizeRouteNearestNeighbor } = await import("@/lib/engines/logistics-engine");
      const points = inputs.points as { id: string; lat: number; lng: number }[];
      if (!Array.isArray(points)) throw new Error("points must be an array");
      return optimizeRouteNearestNeighbor(points);
    }
    case "freight_calculator": {
      const { calculateFreightCost } = await import("@/lib/engines/logistics-engine");
      return calculateFreightCost(Number(inputs.actualWeightKg), Number(inputs.volumeCbm), Number(inputs.ratePerKg), inputs.volumetricDivisor ? Number(inputs.volumetricDivisor) : undefined);
    }
    case "delivery_eta_engine": {
      const { estimateDeliveryEta } = await import("@/lib/engines/logistics-engine");
      return estimateDeliveryEta(Number(inputs.distanceKm), Number(inputs.avgSpeedKmh), inputs.handlingBufferHours ? Number(inputs.handlingBufferHours) : undefined);
    }
    case "vehicle_utilization_engine": {
      const { calculateVehicleUtilization } = await import("@/lib/engines/logistics-engine");
      return { utilizationPercent: calculateVehicleUtilization(Number(inputs.loadedWeightKg), Number(inputs.vehicleCapacityKg)) };
    }
    case "container_utilization_engine": {
      const { calculateContainerUtilization } = await import("@/lib/engines/logistics-engine");
      return { utilizationPercent: calculateContainerUtilization(Number(inputs.loadedVolumeCbm), Number(inputs.containerCapacityCbm)) };
    }
    case "shipment_cost_calculator": {
      const { calculateShipmentCost } = await import("@/lib/engines/logistics-engine");
      return { shipmentCost: calculateShipmentCost({
        freight: Number(inputs.freight), handling: inputs.handling ? Number(inputs.handling) : undefined,
        insurance: inputs.insurance ? Number(inputs.insurance) : undefined, customs: inputs.customs ? Number(inputs.customs) : undefined,
      }) };
    }
  }

  // Marketing Engine (tree4-unified/50-completion-plan area 8, Wave 170)
  // -- 6 of 6 registered engines, full category complete.
  switch (engineKey) {
    case "marketing_roi_calculator": {
      const { calculateMarketingRoi } = await import("@/lib/engines/marketing-engine");
      return { roiPercent: calculateMarketingRoi(Number(inputs.revenueGenerated), Number(inputs.marketingSpend)) };
    }
    case "cac_calculator": {
      const { calculateCac } = await import("@/lib/engines/marketing-engine");
      return { cac: calculateCac(Number(inputs.totalAcquisitionSpend), Number(inputs.newCustomersAcquired)) };
    }
    case "roas_calculator": {
      const { calculateRoas } = await import("@/lib/engines/marketing-engine");
      return { roas: calculateRoas(Number(inputs.revenueFromAds), Number(inputs.adSpend)) };
    }
    case "attribution_engine": {
      const { attributeConversionLinear } = await import("@/lib/engines/marketing-engine");
      const touchpoints = inputs.touchpoints as { channel: string }[];
      if (!Array.isArray(touchpoints)) throw new Error("touchpoints must be an array");
      return attributeConversionLinear(touchpoints, Number(inputs.conversionValue));
    }
    case "campaign_scoring_engine": {
      const { calculateCampaignScore } = await import("@/lib/engines/marketing-engine");
      const weights = inputs.weights as { reach: number; engagement: number; conversion: number } | undefined;
      return { campaignScore: calculateCampaignScore({
        reachScore: Number(inputs.reachScore), engagementScore: Number(inputs.engagementScore), conversionScore: Number(inputs.conversionScore),
      }, weights) };
    }
    case "funnel_conversion_calculator": {
      const { calculateFunnelConversion } = await import("@/lib/engines/marketing-engine");
      const stageCounts = inputs.stageCounts as { stage: string; count: number }[];
      if (!Array.isArray(stageCounts)) throw new Error("stageCounts must be an array");
      return { funnel: calculateFunnelConversion(stageCounts) };
    }
  }

  // Project Management Engine (tree4-unified/50-completion-plan area 8,
  // Wave 170) -- 6 of 6 registered engines, full category complete.
  switch (engineKey) {
    case "critical_path_engine": {
      const { calculateCriticalPath } = await import("@/lib/engines/project-management-engine");
      const tasks = inputs.tasks as { id: string; duration: number; dependsOn: string[] }[];
      if (!Array.isArray(tasks)) throw new Error("tasks must be an array");
      return { criticalPath: calculateCriticalPath(tasks) };
    }
    case "resource_allocation_engine": {
      const { allocateResources } = await import("@/lib/engines/project-management-engine");
      const tasks = inputs.tasks as { id: string; requiredCapacity: number; priority: number }[];
      if (!Array.isArray(tasks)) throw new Error("tasks must be an array");
      return allocateResources(tasks, Number(inputs.availableCapacity));
    }
    case "cost_variance_engine": {
      const { calculateCostVariance } = await import("@/lib/engines/project-management-engine");
      return { costVariance: calculateCostVariance(Number(inputs.earnedValue), Number(inputs.actualCost)) };
    }
    case "schedule_variance_engine": {
      const { calculateScheduleVariance } = await import("@/lib/engines/project-management-engine");
      return { scheduleVariance: calculateScheduleVariance(Number(inputs.earnedValue), Number(inputs.plannedValue)) };
    }
    case "earned_value_calculator": {
      const { calculateEarnedValueMetrics } = await import("@/lib/engines/project-management-engine");
      return calculateEarnedValueMetrics({
        plannedValue: Number(inputs.plannedValue), earnedValue: Number(inputs.earnedValue),
        actualCost: Number(inputs.actualCost), budgetAtCompletion: Number(inputs.budgetAtCompletion),
      });
    }
    case "burndown_calculator": {
      const { calculateBurndown } = await import("@/lib/engines/project-management-engine");
      const completedPointsByDay = inputs.completedPointsByDay as number[];
      if (!Array.isArray(completedPointsByDay)) throw new Error("completedPointsByDay must be an array");
      return { burndown: calculateBurndown(Number(inputs.totalStoryPoints), Number(inputs.sprintDays), completedPointsByDay.map(Number)) };
    }
  }

  // CRM Engine (tree4-unified/50-completion-plan area 8, Wave 170) -- 5 of
  // 5 registered engines, full category complete.
  switch (engineKey) {
    case "customer_lifetime_value_calculator": {
      const { calculateCustomerLifetimeValue } = await import("@/lib/engines/crm-engine");
      return { clv: calculateCustomerLifetimeValue(Number(inputs.avgOrderValue), Number(inputs.purchaseFrequencyPerYear), Number(inputs.customerLifespanYears)) };
    }
    case "churn_probability_calculator": {
      const { calculateChurnProbability } = await import("@/lib/engines/crm-engine");
      return { churnProbability: calculateChurnProbability(Number(inputs.daysSinceLastActivity), Number(inputs.engagementDeclinePercent)) };
    }
    case "rfm_scoring_engine": {
      const { calculateRfmScore } = await import("@/lib/engines/crm-engine");
      const customers = inputs.customers as { id: string; recencyDays: number; frequency: number; monetary: number }[];
      if (!Array.isArray(customers)) throw new Error("customers must be an array");
      return calculateRfmScore(customers);
    }
    case "opportunity_score_calculator": {
      const { calculateOpportunityScore } = await import("@/lib/engines/crm-engine");
      return { opportunityScore: calculateOpportunityScore({
        budget: Number(inputs.budget), authority: Number(inputs.authority), need: Number(inputs.need), timeline: Number(inputs.timeline),
      }) };
    }
    case "customer_health_score": {
      const { calculateCustomerHealthScore } = await import("@/lib/engines/crm-engine");
      const weights = inputs.weights as { usage: number; support: number; payment: number } | undefined;
      return { healthScore: calculateCustomerHealthScore({
        usageScore: Number(inputs.usageScore), supportScore: Number(inputs.supportScore), paymentScore: Number(inputs.paymentScore),
      }, weights) };
    }
  }

  // Sales Engine (tree4-unified/50-completion-plan area 8, Wave 170) -- 7
  // of 7 registered engines, full category complete. markup_calculator
  // supports both directions of the markup relationship (compute markup%
  // from prices, or compute a price from cost+markup%) via a `mode` input.
  switch (engineKey) {
    case "margin_calculator": {
      const { calculateMargin } = await import("@/lib/engines/sales-engine");
      return { marginPercent: calculateMargin(Number(inputs.sellingPrice), Number(inputs.cost)) };
    }
    case "markup_calculator": {
      const { calculateMarkup, priceFromMarkup } = await import("@/lib/engines/sales-engine");
      if (inputs.mode === "price_from_markup") {
        return { price: priceFromMarkup(Number(inputs.cost), Number(inputs.markupPercent)) };
      }
      return { markupPercent: calculateMarkup(Number(inputs.sellingPrice), Number(inputs.cost)) };
    }
    case "sales_incentive_calculator": {
      const { calculateSalesIncentive } = await import("@/lib/engines/sales-engine");
      const slabs = inputs.slabs as { minAchievementPercent: number; incentivePercentOfSales: number }[];
      if (!Array.isArray(slabs)) throw new Error("slabs must be an array");
      return { incentiveAmount: calculateSalesIncentive(Number(inputs.achievedSales), Number(inputs.targetSales), slabs) };
    }
    case "pricing_engine": {
      const { priceForTargetMargin } = await import("@/lib/engines/sales-engine");
      return { price: priceForTargetMargin(Number(inputs.cost), Number(inputs.targetMarginPercent)) };
    }
    case "quote_optimizer": {
      const { optimizeQuoteDiscount } = await import("@/lib/engines/sales-engine");
      return { maxDiscountPercent: optimizeQuoteDiscount(Number(inputs.cost), Number(inputs.listPrice), Number(inputs.minAcceptableMarginPercent)) };
    }
    case "sales_forecast_engine": {
      const { forecastSales } = await import("@/lib/engines/sales-engine");
      const historicalValues = inputs.historicalValues as number[];
      if (!Array.isArray(historicalValues)) throw new Error("historicalValues must be an array");
      return { forecast: forecastSales(historicalValues.map(Number), Number(inputs.periodsAhead)) };
    }
    case "pipeline_probability_engine": {
      const { calculatePipelineExpectedValue } = await import("@/lib/engines/sales-engine");
      const deals = inputs.deals as { stage: string; amount: number }[];
      if (!Array.isArray(deals)) throw new Error("deals must be an array");
      return { expectedValue: calculatePipelineExpectedValue(deals) };
    }
  }

  // Fixed Asset Engine (tree4-unified/50-completion-plan area 8, Wave 170)
  // -- 8 of 8 registered engines, full category complete.
  switch (engineKey) {
    case "straight_line_depreciation_engine": {
      const { straightLineDepreciation } = await import("@/lib/engines/fixed-asset-engine");
      return { schedule: straightLineDepreciation({ cost: Number(inputs.cost), salvageValue: Number(inputs.salvageValue), usefulLifeYears: Number(inputs.usefulLifeYears) }) };
    }
    case "wdv_depreciation_engine": {
      const { writtenDownValueDepreciation } = await import("@/lib/engines/fixed-asset-engine");
      return { schedule: writtenDownValueDepreciation({
        cost: Number(inputs.cost), salvageValue: Number(inputs.salvageValue), usefulLifeYears: Number(inputs.usefulLifeYears),
        rate: inputs.rate ? Number(inputs.rate) : undefined,
      }) };
    }
    case "useful_life_calculator": {
      const { calculateRemainingUsefulLife } = await import("@/lib/engines/fixed-asset-engine");
      return { remainingUsefulLifeYears: calculateRemainingUsefulLife(Number(inputs.originalUsefulLifeYears), Number(inputs.ageInYears)) };
    }
    case "asset_transfer_engine": {
      const { transferAsset } = await import("@/lib/engines/fixed-asset-engine");
      return transferAsset(Number(inputs.netBookValue), String(inputs.fromLocation ?? ""), String(inputs.toLocation ?? ""));
    }
    case "asset_disposal_engine": {
      const { calculateDisposalGainLoss } = await import("@/lib/engines/fixed-asset-engine");
      return calculateDisposalGainLoss(Number(inputs.netBookValue), Number(inputs.saleProceeds));
    }
    case "capitalization_engine": {
      const { shouldCapitalize } = await import("@/lib/engines/fixed-asset-engine");
      return { shouldCapitalize: shouldCapitalize(Number(inputs.expenseAmount), Number(inputs.capitalizationThreshold), truthy(inputs.extendsUsefulLife)) };
    }
    case "revaluation_engine": {
      const { revalueAsset } = await import("@/lib/engines/fixed-asset-engine");
      return revalueAsset(Number(inputs.currentNetBookValue), Number(inputs.fairValue));
    }
    case "impairment_engine": {
      const { calculateImpairmentLoss } = await import("@/lib/engines/fixed-asset-engine");
      return calculateImpairmentLoss(Number(inputs.carryingValue), Number(inputs.recoverableAmount));
    }
  }

  // Data Quality Engine (tree4-unified/50-completion-plan area 8, Wave 170)
  // -- 7 of 8 registered engines (pan_validation_engine already wired
  // separately for the TDS/TCS category, reusing the same isValidPanFormat
  // here under this category's own key). data_duplicate_detection_engine
  // has no standalone pure function anywhere in this codebase -- deferred,
  // not force-fit onto document-processing-engine.ts's hash-based
  // duplicate detector, which is shaped for documents specifically.
  switch (engineKey) {
    case "pan_validation_engine_dq": {
      const { isValidPanFormat } = await import("@/lib/engines/data-quality-engine");
      return { valid: isValidPanFormat(String(inputs.pan ?? "")) };
    }
    case "gstin_validation_engine": {
      const { isValidGstin, isValidGstinFormat } = await import("@/lib/engines/data-quality-engine");
      return { validFormat: isValidGstinFormat(String(inputs.gstin ?? "")), validChecksum: isValidGstin(String(inputs.gstin ?? "")) };
    }
    case "ifsc_validation_engine": {
      const { isValidIfscFormat } = await import("@/lib/engines/data-quality-engine");
      return { valid: isValidIfscFormat(String(inputs.ifsc ?? "")) };
    }
    case "email_validation_engine": {
      const { isValidEmail } = await import("@/lib/engines/data-quality-engine");
      return { valid: isValidEmail(String(inputs.email ?? "")) };
    }
    case "phone_validation_engine": {
      const { isValidPhoneNumber } = await import("@/lib/engines/data-quality-engine");
      return { valid: isValidPhoneNumber(String(inputs.phone ?? ""), inputs.defaultCountry ? String(inputs.defaultCountry) : undefined) };
    }
    case "bank_account_validation_engine": {
      const { isValidBankAccountFormat } = await import("@/lib/engines/data-quality-engine");
      return { valid: isValidBankAccountFormat(String(inputs.accountNumber ?? "")) };
    }
    case "address_standardization_engine": {
      const { standardizeAddress } = await import("@/lib/engines/data-quality-engine");
      return { standardizedAddress: standardizeAddress(String(inputs.address ?? "")) };
    }
  }

  // Document Processing Engine (tree4-unified/50-completion-plan area 8,
  // Wave 170) -- 1 of 1 registered engine, full category complete.
  switch (engineKey) {
    case "duplicate_document_detection_engine": {
      const { detectDuplicateDocumentsByHash } = await import("@/lib/engines/document-processing-engine");
      const documents = inputs.documents as { id: string; contentHash: string }[];
      if (!Array.isArray(documents)) throw new Error("documents must be an array");
      return { duplicateGroups: detectDuplicateDocumentsByHash(documents) };
    }
  }

  switch (engineKey) {
    default:
      throw new Error(`No engine dispatcher implemented for ${engineKey}`);
  }
}
