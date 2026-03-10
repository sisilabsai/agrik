import { NavLink, useOutletContext } from "react-router-dom";
import { Icon } from "../components/Visuals";
import {
  farmRiskAverage,
  formatDecimal,
  formatMoney,
  inferProjectedRevenue,
  type FarmerFarmWorkspaceContext,
} from "./FarmerFarm";

export default function FarmerFarmHome() {
  const {
    farms,
    activeFarm,
    activeFarmId,
    uniqueCropCount,
    farmsWithWaterAccess,
    insuredFarms,
    totalAreaAcres,
    totalProjectedRevenue,
    totalPlannedCost,
    portfolioMargin,
    totalCoverage,
    primaryCurrency,
    mixedCurrency,
    activeFarmReadinessItems,
    activeFarmReadinessScore,
    activeFarmInsights,
    setActiveFarmId,
    removeFarm,
    markPrimaryFarm,
  } = useOutletContext<FarmerFarmWorkspaceContext>();

  return (
    <>
      <section className="farmer-card">
        <div className="farmer-card-header">
          <div className="section-title-with-icon">
            <span className="section-icon">
              <Icon name="overview" size={18} />
            </span>
            <div>
              <div className="label">Portfolio</div>
              <h3>Registered farms and totals</h3>
            </div>
          </div>
          <div className="farmer-inline-meta">
            Insurance coverage tracked: {totalCoverage > 0 ? formatMoney(totalCoverage, primaryCurrency) : "--"}.
            {mixedCurrency ? " Portfolio uses mixed currencies." : ""}
          </div>
        </div>

        <div className="farm-summary-grid">
          <div className="farm-summary-card">
            <div className="label">Farms</div>
            <div className="farm-summary-value">{farms.length}</div>
          </div>
          <div className="farm-summary-card">
            <div className="label">Unique crops</div>
            <div className="farm-summary-value">{uniqueCropCount}</div>
          </div>
          <div className="farm-summary-card">
            <div className="label">Water access farms</div>
            <div className="farm-summary-value">{farmsWithWaterAccess}</div>
          </div>
          <div className="farm-summary-card">
            <div className="label">Insured farms</div>
            <div className="farm-summary-value">{insuredFarms}</div>
          </div>
          <div className="farm-summary-card">
            <div className="label">Total acres</div>
            <div className="farm-summary-value">{totalAreaAcres > 0 ? totalAreaAcres.toFixed(1) : "--"}</div>
          </div>
          <div className="farm-summary-card">
            <div className="label">Expected revenue</div>
            <div className="farm-summary-value">{totalProjectedRevenue > 0 ? formatMoney(totalProjectedRevenue, primaryCurrency) : "--"}</div>
          </div>
          <div className="farm-summary-card">
            <div className="label">Planned cost</div>
            <div className="farm-summary-value">{totalPlannedCost > 0 ? formatMoney(totalPlannedCost, primaryCurrency) : "--"}</div>
          </div>
          <div className="farm-summary-card">
            <div className="label">Expected margin</div>
            <div className="farm-summary-value">{portfolioMargin !== 0 ? formatMoney(portfolioMargin, primaryCurrency) : "--"}</div>
          </div>
        </div>
      </section>

      <section className="farmer-card">
        <div className="farmer-card-header">
          <div className="section-title-with-icon">
            <span className="section-icon">
              <Icon name="farm" size={18} />
            </span>
            <div>
              <div className="label">Switcher</div>
              <h3>Choose the farm you want to work on</h3>
            </div>
          </div>
          <NavLink to="/dashboard/farm/create" className="btn ghost small">
            <Icon name="plus" size={14} />
            Create farm
          </NavLink>
        </div>

        <div className="farm-portfolio-grid">
          {farms.map((farm) => (
            <article key={farm.id} className={`farm-portfolio-item ${farm.id === activeFarmId ? "active" : ""}`}>
              <button className="farm-portfolio-select" type="button" onClick={() => setActiveFarmId(farm.id)}>
                <div className="farm-portfolio-title-row">
                  <strong>{farm.name || "Unnamed farm"}</strong>
                  {farm.isPrimary ? <span className="pill">primary</span> : null}
                </div>
                <div className="farm-portfolio-meta">
                  {[farm.parish, farm.district].filter(Boolean).join(", ") || "Location not set"}
                </div>
                <div className="farm-portfolio-meta">{farm.crops.length} crop{farm.crops.length === 1 ? "" : "s"}</div>
                <div className="farm-portfolio-meta">
                  Risk: {formatDecimal(farmRiskAverage(farm))}/5 | Revenue:{" "}
                  {inferProjectedRevenue(farm) > 0 ? formatMoney(inferProjectedRevenue(farm), farm.finance.currency || "UGX") : "--"}
                </div>
              </button>
              <div className="farm-portfolio-actions">
                <button
                  className="btn ghost tiny grik-icon-btn"
                  type="button"
                  onClick={() => markPrimaryFarm(farm.id)}
                  title="Set as primary farm"
                  aria-label="Set as primary farm"
                >
                  <Icon name="shield" size={13} />
                </button>
                <button
                  className="btn ghost tiny grik-icon-btn"
                  type="button"
                  onClick={() => removeFarm(farm.id)}
                  disabled={farms.length <= 1}
                  title="Remove farm"
                  aria-label="Remove farm"
                >
                  <Icon name="trash" size={13} />
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      {activeFarm ? (
        <div className="farmer-dashboard-grid">
          <section className="farmer-card">
            <div className="farmer-card-header">
              <div>
                <div className="label">Active farm</div>
                <h3>{activeFarm.name || "Current farm overview"}</h3>
              </div>
              <NavLink to="/dashboard/farm/manage" className="btn small">
                <Icon name="farm" size={14} />
                Manage farm
              </NavLink>
            </div>

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
          </section>

          <section className="farmer-card">
            <div className="farmer-card-header">
              <div>
                <div className="label">Decision support</div>
                <h3>Priority actions for this farm</h3>
              </div>
              <NavLink to="/dashboard/farm/settings" className="btn ghost small">
                <Icon name="services" size={14} />
                Settings
              </NavLink>
            </div>

            <div className="farm-insight-grid">
              {activeFarmInsights.slice(0, 4).map((insight) => (
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
          </section>
        </div>
      ) : null}
    </>
  );
}
