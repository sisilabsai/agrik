import { useOutletContext } from "react-router-dom";
import { Icon } from "../components/Visuals";
import {
  AGROECOLOGY_PRACTICES,
  CLAIM_STATUS_OPTIONS,
  CURRENCY_OPTIONS,
  INSURANCE_PRODUCT_OPTIONS,
  IRRIGATION_OPTIONS,
  MECHANIZATION_OPTIONS,
  RISK_LEVEL_OPTIONS,
  formatMoney,
  type FarmerFarmWorkspaceContext,
} from "./FarmerFarm";
import FarmerCropSelector from "./FarmerCropSelector";

export default function FarmerFarmManage() {
  const {
    activeFarm,
    activeProjectedRevenue,
    activePlannedCost,
    activeExpectedMargin,
    activeFarmRiskScore,
    breakEvenPrice,
    breakEvenYield,
    activeCashRunway,
    activeCoverageRatio,
    activeFarmInsights,
    activeFarmReadinessItems,
    activeFarmReadinessScore,
    cropOptions,
    soilTypeOptions,
    onActiveFarmChange,
    onFinanceChange,
    onInsuranceChange,
    onExpectationsChange,
    onRiskChange,
    onOperationsChange,
  } = useOutletContext<FarmerFarmWorkspaceContext>();

  if (!activeFarm) {
    return <section className="farmer-card">No farm is selected for management.</section>;
  }

  return (
    <>
      <section className="farmer-card">
        <div className="farmer-card-header">
          <div className="section-title-with-icon">
            <span className="section-icon">
              <Icon name="farm" size={18} />
            </span>
            <div>
              <div className="label">Manage farm</div>
              <h3>{activeFarm.name || "Farm details"}</h3>
            </div>
          </div>
          {activeFarm.isPrimary ? <span className="pill">Primary planning farm</span> : null}
        </div>

        <div className="farmer-filter-chip-row farm-section-nav">
          <a className="btn ghost tiny" href="#farm-identity">Identity</a>
          <a className="btn ghost tiny" href="#farm-expectations">Expectations</a>
          <a className="btn ghost tiny" href="#farm-finance">Finance</a>
          <a className="btn ghost tiny" href="#farm-insurance">Insurance</a>
          <a className="btn ghost tiny" href="#farm-risk-operations">Risk and ops</a>
          <a className="btn ghost tiny" href="#farm-intelligence">Intelligence</a>
        </div>
      </section>

      <section className="farmer-card" id="farm-identity">
        <div className="farmer-card-header">
          <div className="section-title-with-icon">
            <span className="section-icon">
              <Icon name="farm" size={18} />
            </span>
            <div>
              <div className="label">Identity</div>
              <h3>Core farm details</h3>
            </div>
          </div>
        </div>

        <div className="farmer-dashboard-grid">
          <div className="farm-kpi-grid">
            <article className="farm-kpi-card">
              <div className="label">Readiness</div>
              <strong>{activeFarmReadinessScore}/5</strong>
            </article>
            <article className="farm-kpi-card">
              <div className="label">Crop mix</div>
              <strong>{activeFarm.crops.length || "--"}</strong>
            </article>
            <article className="farm-kpi-card">
              <div className="label">Water access</div>
              <strong>{activeFarm.hasWaterAccess ? "Available" : "Not tracked"}</strong>
            </article>
            <article className="farm-kpi-card">
              <div className="label">Last planting</div>
              <strong>{activeFarm.lastPlantingDate || "--"}</strong>
            </article>
          </div>

          <div className="farmer-side-summary">
            {activeFarmReadinessItems.map((item) => (
              <div key={item.label} className="farmer-side-summary-item">
                <span>{item.label}</span>
                <strong>{item.ready ? "Ready" : "Pending"}</strong>
              </div>
            ))}
          </div>
        </div>

        <div className="farmer-form-grid">
          <label className="field">
            Farm name
            <input value={activeFarm.name} onChange={(event) => onActiveFarmChange("name", event.target.value)} placeholder="Main farm" />
          </label>
          <label className="field">
            District
            <input value={activeFarm.district} onChange={(event) => onActiveFarmChange("district", event.target.value)} placeholder="Lira" />
          </label>
          <label className="field">
            Parish
            <input value={activeFarm.parish} onChange={(event) => onActiveFarmChange("parish", event.target.value)} placeholder="Aromo" />
          </label>
          <label className="field farmer-form-span">
            Crops grown
            <FarmerCropSelector options={cropOptions} selected={activeFarm.crops} onChange={(value) => onActiveFarmChange("crops", value)} />
            <span className="field-note">Use the checkboxes to update the crop mix for this farm.</span>
          </label>
          <label className="field">
            Last planting date
            <input type="date" value={activeFarm.lastPlantingDate} onChange={(event) => onActiveFarmChange("lastPlantingDate", event.target.value)} />
          </label>
          <label className="field">
            Soil type
            <select value={activeFarm.soilType} onChange={(event) => onActiveFarmChange("soilType", event.target.value)}>
              <option value="">Select soil type</option>
              {soilTypeOptions.map((soilType) => (
                <option key={soilType} value={soilType}>
                  {soilType}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Farm size (acres)
            <input
              type="number"
              value={activeFarm.farmSizeAcres}
              onChange={(event) => onActiveFarmChange("farmSizeAcres", event.target.value)}
              placeholder="2.5"
            />
          </label>
          <label className="field farmer-form-span">
            Farm notes
            <textarea
              value={activeFarm.notes}
              onChange={(event) => onActiveFarmChange("notes", event.target.value)}
              rows={3}
              placeholder="Main constraints, land issues, labor bottlenecks, or critical context."
            />
          </label>
        </div>

        <label className="toggle">
          <input type="checkbox" checked={activeFarm.hasWaterAccess} onChange={(event) => onActiveFarmChange("hasWaterAccess", event.target.checked)} />
          <span>Water access available on this farm</span>
        </label>
      </section>

      <section className="farmer-card" id="farm-expectations">
        <div className="farmer-card-header">
          <div className="section-title-with-icon">
            <span className="section-icon">
              <Icon name="activity" size={18} />
            </span>
            <div>
              <div className="label">Season expectations</div>
              <h3>Yield, market, and outcome targets</h3>
            </div>
          </div>
        </div>

        <div className="farmer-form-grid">
          <label className="field">
            Season label
            <input
              value={activeFarm.expectations.seasonLabel}
              onChange={(event) => onExpectationsChange("seasonLabel", event.target.value)}
              placeholder="2026 Season A"
            />
          </label>
          <label className="field">
            Planting window start
            <input
              type="date"
              value={activeFarm.expectations.plantingWindowStart}
              onChange={(event) => onExpectationsChange("plantingWindowStart", event.target.value)}
            />
          </label>
          <label className="field">
            Planting window end
            <input
              type="date"
              value={activeFarm.expectations.plantingWindowEnd}
              onChange={(event) => onExpectationsChange("plantingWindowEnd", event.target.value)}
            />
          </label>
          <label className="field">
            Target harvest date
            <input
              type="date"
              value={activeFarm.expectations.targetHarvestDate}
              onChange={(event) => onExpectationsChange("targetHarvestDate", event.target.value)}
            />
          </label>
          <label className="field">
            Target yield (kg)
            <input
              type="number"
              value={activeFarm.expectations.targetYieldKg}
              onChange={(event) => onExpectationsChange("targetYieldKg", event.target.value)}
              placeholder="3600"
            />
          </label>
          <label className="field">
            Expected price per kg
            <input
              type="number"
              value={activeFarm.expectations.expectedPricePerKg}
              onChange={(event) => onExpectationsChange("expectedPricePerKg", event.target.value)}
              placeholder="1200"
            />
          </label>
          <label className="field">
            Revenue target (optional override)
            <input
              type="number"
              value={activeFarm.expectations.projectedRevenue}
              onChange={(event) => onExpectationsChange("projectedRevenue", event.target.value)}
              placeholder="4200000"
            />
          </label>
          <label className="field">
            Confidence (%)
            <input
              type="number"
              value={activeFarm.expectations.confidencePct}
              onChange={(event) => onExpectationsChange("confidencePct", event.target.value)}
              placeholder="65"
            />
          </label>
          <label className="field farmer-form-span">
            Buyer plan / market channel
            <textarea
              rows={2}
              value={activeFarm.expectations.buyerPlan}
              onChange={(event) => onExpectationsChange("buyerPlan", event.target.value)}
              placeholder="Cooperative bulk sale, direct market, contract buyer..."
            />
          </label>
        </div>

        <div className="farm-kpi-grid">
          <article className="farm-kpi-card">
            <div className="label">Projected revenue</div>
            <strong>{activeProjectedRevenue > 0 ? formatMoney(activeProjectedRevenue, activeFarm.finance.currency || "UGX") : "--"}</strong>
          </article>
          <article className="farm-kpi-card">
            <div className="label">Planned season cost</div>
            <strong>{activePlannedCost > 0 ? formatMoney(activePlannedCost, activeFarm.finance.currency || "UGX") : "--"}</strong>
          </article>
          <article className="farm-kpi-card">
            <div className="label">Expected margin</div>
            <strong>{activeExpectedMargin !== 0 ? formatMoney(activeExpectedMargin, activeFarm.finance.currency || "UGX") : "--"}</strong>
          </article>
          <article className="farm-kpi-card">
            <div className="label">Break-even price/kg</div>
            <strong>{breakEvenPrice != null ? formatMoney(breakEvenPrice, activeFarm.finance.currency || "UGX") : "--"}</strong>
          </article>
          <article className="farm-kpi-card">
            <div className="label">Break-even yield (kg)</div>
            <strong>{breakEvenYield != null ? breakEvenYield.toFixed(0) : "--"}</strong>
          </article>
          <article className="farm-kpi-card">
            <div className="label">Risk score</div>
            <strong>{activeFarmRiskScore != null ? `${activeFarmRiskScore.toFixed(1)} / 5` : "--"}</strong>
          </article>
        </div>
      </section>

      <section className="farmer-card" id="farm-finance">
        <div className="farmer-card-header">
          <div className="section-title-with-icon">
            <span className="section-icon">
              <Icon name="finance" size={18} />
            </span>
            <div>
              <div className="label">Finance management</div>
              <h3>Budget, liquidity, and credit</h3>
            </div>
          </div>
        </div>

        <div className="farmer-form-grid">
          <label className="field">
            Currency
            <select value={activeFarm.finance.currency} onChange={(event) => onFinanceChange("currency", event.target.value)}>
              {CURRENCY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Planned input cost
            <input type="number" value={activeFarm.finance.plannedInputCost} onChange={(event) => onFinanceChange("plannedInputCost", event.target.value)} placeholder="0" />
          </label>
          <label className="field">
            Planned labor cost
            <input type="number" value={activeFarm.finance.plannedLaborCost} onChange={(event) => onFinanceChange("plannedLaborCost", event.target.value)} placeholder="0" />
          </label>
          <label className="field">
            Planned logistics cost
            <input
              type="number"
              value={activeFarm.finance.plannedLogisticsCost}
              onChange={(event) => onFinanceChange("plannedLogisticsCost", event.target.value)}
              placeholder="0"
            />
          </label>
          <label className="field">
            Planned other cost
            <input type="number" value={activeFarm.finance.plannedOtherCost} onChange={(event) => onFinanceChange("plannedOtherCost", event.target.value)} placeholder="0" />
          </label>
          <label className="field">
            Loan principal
            <input type="number" value={activeFarm.finance.loanPrincipal} onChange={(event) => onFinanceChange("loanPrincipal", event.target.value)} placeholder="0" />
          </label>
          <label className="field">
            Loan interest (%)
            <input type="number" value={activeFarm.finance.loanInterestPct} onChange={(event) => onFinanceChange("loanInterestPct", event.target.value)} placeholder="0" />
          </label>
          <label className="field">
            Expected installment
            <input
              type="number"
              value={activeFarm.finance.expectedInstallment}
              onChange={(event) => onFinanceChange("expectedInstallment", event.target.value)}
              placeholder="0"
            />
          </label>
          <label className="field">
            Current cash on hand
            <input type="number" value={activeFarm.finance.currentCashOnHand} onChange={(event) => onFinanceChange("currentCashOnHand", event.target.value)} placeholder="0" />
          </label>
          <label className="field">
            Savings target
            <input type="number" value={activeFarm.finance.savingsTarget} onChange={(event) => onFinanceChange("savingsTarget", event.target.value)} placeholder="0" />
          </label>
          <label className="field farmer-form-span">
            Finance notes
            <textarea
              rows={2}
              value={activeFarm.finance.notes}
              onChange={(event) => onFinanceChange("notes", event.target.value)}
              placeholder="Loan conditions, repayment risks, supplier credit terms..."
            />
          </label>
        </div>
      </section>

      <section className="farmer-card" id="farm-insurance">
        <div className="farmer-card-header">
          <div className="section-title-with-icon">
            <span className="section-icon">
              <Icon name="shield" size={18} />
            </span>
            <div>
              <div className="label">Insurance</div>
              <h3>Protection and claim readiness</h3>
            </div>
          </div>
        </div>

        <label className="toggle">
          <input type="checkbox" checked={activeFarm.insurance.enrolled} onChange={(event) => onInsuranceChange("enrolled", event.target.checked)} />
          <span>Farm enrolled in insurance</span>
        </label>

        <div className="farmer-form-grid">
          <label className="field">
            Insurance provider
            <input value={activeFarm.insurance.provider} onChange={(event) => onInsuranceChange("provider", event.target.value)} placeholder="Name of insurer or cooperative" />
          </label>
          <label className="field">
            Product type
            <select value={activeFarm.insurance.productType} onChange={(event) => onInsuranceChange("productType", event.target.value)}>
              <option value="">Select product</option>
              {INSURANCE_PRODUCT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Policy number
            <input value={activeFarm.insurance.policyNumber} onChange={(event) => onInsuranceChange("policyNumber", event.target.value)} placeholder="Policy reference" />
          </label>
          <label className="field">
            Coverage amount
            <input type="number" value={activeFarm.insurance.coverageAmount} onChange={(event) => onInsuranceChange("coverageAmount", event.target.value)} placeholder="Coverage value" />
          </label>
          <label className="field">
            Premium amount
            <input type="number" value={activeFarm.insurance.premiumAmount} onChange={(event) => onInsuranceChange("premiumAmount", event.target.value)} placeholder="Premium paid" />
          </label>
          <label className="field">
            Policy start date
            <input type="date" value={activeFarm.insurance.startDate} onChange={(event) => onInsuranceChange("startDate", event.target.value)} />
          </label>
          <label className="field">
            Policy end date
            <input type="date" value={activeFarm.insurance.endDate} onChange={(event) => onInsuranceChange("endDate", event.target.value)} />
          </label>
          <label className="field">
            Claim status
            <select value={activeFarm.insurance.claimStatus} onChange={(event) => onInsuranceChange("claimStatus", event.target.value)}>
              {CLAIM_STATUS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Last claim amount
            <input type="number" value={activeFarm.insurance.lastClaimAmount} onChange={(event) => onInsuranceChange("lastClaimAmount", event.target.value)} placeholder="0" />
          </label>
          <label className="field">
            Last claim date
            <input type="date" value={activeFarm.insurance.lastClaimDate} onChange={(event) => onInsuranceChange("lastClaimDate", event.target.value)} />
          </label>
          <label className="field farmer-form-span">
            Trigger model / conditions
            <textarea
              rows={2}
              value={activeFarm.insurance.triggerModel}
              onChange={(event) => onInsuranceChange("triggerModel", event.target.value)}
              placeholder="Rainfall threshold, loss threshold, NDVI trigger, etc."
            />
          </label>
        </div>
      </section>

      <section className="farmer-card" id="farm-risk-operations">
        <div className="farmer-card-header">
          <div className="section-title-with-icon">
            <span className="section-icon">
              <Icon name="climate" size={18} />
            </span>
            <div>
              <div className="label">Risk and operations</div>
              <h3>Preparedness, staffing, and execution</h3>
            </div>
          </div>
        </div>

        <div className="farmer-form-grid">
          <label className="field">
            Drought risk (1-5)
            <select value={activeFarm.risk.droughtRisk} onChange={(event) => onRiskChange("droughtRisk", event.target.value)}>
              <option value="">Select</option>
              {RISK_LEVEL_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Flood risk (1-5)
            <select value={activeFarm.risk.floodRisk} onChange={(event) => onRiskChange("floodRisk", event.target.value)}>
              <option value="">Select</option>
              {RISK_LEVEL_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Pest risk (1-5)
            <select value={activeFarm.risk.pestRisk} onChange={(event) => onRiskChange("pestRisk", event.target.value)}>
              <option value="">Select</option>
              {RISK_LEVEL_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Disease risk (1-5)
            <select value={activeFarm.risk.diseaseRisk} onChange={(event) => onRiskChange("diseaseRisk", event.target.value)}>
              <option value="">Select</option>
              {RISK_LEVEL_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Market risk (1-5)
            <select value={activeFarm.risk.marketRisk} onChange={(event) => onRiskChange("marketRisk", event.target.value)}>
              <option value="">Select</option>
              {RISK_LEVEL_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Next preparedness drill
            <input type="date" value={activeFarm.risk.nextPreparednessDrillDate} onChange={(event) => onRiskChange("nextPreparednessDrillDate", event.target.value)} />
          </label>
          <label className="field farmer-form-span">
            Mitigation plan
            <textarea
              rows={2}
              value={activeFarm.risk.mitigationPlan}
              onChange={(event) => onRiskChange("mitigationPlan", event.target.value)}
              placeholder="Contingency actions for drought, pests, flood, and market shocks."
            />
          </label>
        </div>

        <div className="farmer-form-grid">
          <label className="field">
            Lead farmer
            <input value={activeFarm.operations.leadFarmerName} onChange={(event) => onOperationsChange("leadFarmerName", event.target.value)} placeholder="Farm lead name" />
          </label>
          <label className="field">
            Lead farmer phone
            <input value={activeFarm.operations.leadFarmerPhone} onChange={(event) => onOperationsChange("leadFarmerPhone", event.target.value)} placeholder="+256..." />
          </label>
          <label className="field">
            Extension officer
            <input value={activeFarm.operations.extensionOfficerName} onChange={(event) => onOperationsChange("extensionOfficerName", event.target.value)} placeholder="Officer or agent" />
          </label>
          <label className="field">
            Extension officer phone
            <input value={activeFarm.operations.extensionOfficerPhone} onChange={(event) => onOperationsChange("extensionOfficerPhone", event.target.value)} placeholder="+256..." />
          </label>
          <label className="field">
            Irrigation type
            <select value={activeFarm.operations.irrigationType} onChange={(event) => onOperationsChange("irrigationType", event.target.value)}>
              <option value="">Select irrigation</option>
              {IRRIGATION_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Storage capacity (kg)
            <input type="number" value={activeFarm.operations.storageCapacityKg} onChange={(event) => onOperationsChange("storageCapacityKg", event.target.value)} placeholder="1200" />
          </label>
          <label className="field">
            Household labor count
            <input type="number" value={activeFarm.operations.householdLaborCount} onChange={(event) => onOperationsChange("householdLaborCount", event.target.value)} placeholder="3" />
          </label>
          <label className="field">
            Hired labor count
            <input type="number" value={activeFarm.operations.hiredLaborCount} onChange={(event) => onOperationsChange("hiredLaborCount", event.target.value)} placeholder="6" />
          </label>
          <label className="field">
            Mechanization access
            <select value={activeFarm.operations.mechanizationAccess} onChange={(event) => onOperationsChange("mechanizationAccess", event.target.value)}>
              <option value="">Select</option>
              {MECHANIZATION_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Input supplier
            <input value={activeFarm.operations.inputSupplier} onChange={(event) => onOperationsChange("inputSupplier", event.target.value)} placeholder="Supplier, agro-dealer, cooperative" />
          </label>
          <label className="field">
            Next action date
            <input type="date" value={activeFarm.operations.nextActionDate} onChange={(event) => onOperationsChange("nextActionDate", event.target.value)} />
          </label>
          <label className="field farmer-form-span">
            Next action note
            <textarea
              rows={2}
              value={activeFarm.operations.nextActionNote}
              onChange={(event) => onOperationsChange("nextActionNote", event.target.value)}
              placeholder="What must be done next and by whom?"
            />
          </label>
          <label className="field farmer-form-span">
            Agroecology practices in use
            <select
              multiple
              value={activeFarm.operations.agroecologyPractices}
              onChange={(event) =>
                onOperationsChange(
                  "agroecologyPractices",
                  Array.from(event.target.selectedOptions, (option) => option.value)
                )
              }
            >
              {AGROECOLOGY_PRACTICES.map((practice) => (
                <option key={practice} value={practice}>
                  {practice}
                </option>
              ))}
            </select>
            <span className="field-note">Track climate-smart and regenerative practices per farm.</span>
          </label>
        </div>
      </section>

      <section className="farmer-card" id="farm-intelligence">
        <div className="farmer-card-header">
          <div className="section-title-with-icon">
            <span className="section-icon">
              <Icon name="spark" size={18} />
            </span>
            <div>
              <div className="label">Farm intelligence</div>
              <h3>Priority actions from your live profile</h3>
            </div>
          </div>
        </div>

        <div className="farm-insight-grid">
          {activeFarmInsights.map((insight) => (
            <article key={insight.id} className={`farm-insight-card ${insight.level}`}>
              <div className="farm-insight-heading">
                <strong>{insight.title}</strong>
                <span className={`farm-insight-badge ${insight.level}`}>{insight.level}</span>
              </div>
              <p>{insight.detail}</p>
              <div className="farm-insight-action">{insight.action}</div>
            </article>
          ))}
        </div>

        <div className="farm-insight-meta">
          Cash runway: {activeCashRunway != null ? `${Math.max(activeCashRunway, 0).toFixed(2)}x season cost` : "--"} | Coverage ratio:{" "}
          {activeCoverageRatio != null ? `${(Math.max(activeCoverageRatio, 0) * 100).toFixed(0)}% of expected revenue` : "--"} | Risk score:{" "}
          {activeFarmRiskScore != null ? `${activeFarmRiskScore.toFixed(1)} / 5` : "--"}
        </div>
      </section>
    </>
  );
}
