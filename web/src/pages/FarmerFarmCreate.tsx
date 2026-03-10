import { NavLink, useOutletContext } from "react-router-dom";
import { Icon } from "../components/Visuals";
import { type FarmerFarmWorkspaceContext } from "./FarmerFarm";

export default function FarmerFarmCreate() {
  const { activeFarm, cropOptions, soilTypeOptions, isActiveFarmEmpty, addFarm, onActiveFarmChange, onExpectationsChange, handleSave, saving } =
    useOutletContext<FarmerFarmWorkspaceContext>();

  if (!activeFarm) {
    return <section className="farmer-card">No active farm draft is available.</section>;
  }

  return (
    <>
      <section className="farmer-card farmer-command-hero farm-create-hero">
        <div className="farmer-command-hero-copy">
          <div className="label">Create farm</div>
          <h3>Use a clean setup flow before moving into the full management page</h3>
          <p className="muted">
            This page focuses on identity, crop mix, and season targets. Use <strong>Create fresh draft</strong> whenever you want a new farm record instead of editing the selected one.
          </p>
        </div>
        <div className="farmer-command-actions">
          <button className="btn ghost small" type="button" onClick={addFarm}>
            <Icon name="plus" size={14} />
            Create fresh draft
          </button>
          <button className="btn small" type="button" onClick={handleSave} disabled={saving}>
            <Icon name="send" size={14} />
            {saving ? "Saving..." : "Save new farm"}
          </button>
        </div>
      </section>

      <section className="farmer-card">
        <div className="farmer-card-header">
          <div>
            <div className="label">Selected draft</div>
            <h3>{activeFarm.name || "New farm draft"}</h3>
          </div>
          <div className="farmer-inline-meta">{isActiveFarmEmpty ? "This looks like a fresh farm record." : "You are editing the currently selected farm."}</div>
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
          <label className="field">
            Farm size (acres)
            <input
              type="number"
              value={activeFarm.farmSizeAcres}
              onChange={(event) => onActiveFarmChange("farmSizeAcres", event.target.value)}
              placeholder="2.5"
            />
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
            Last planting date
            <input type="date" value={activeFarm.lastPlantingDate} onChange={(event) => onActiveFarmChange("lastPlantingDate", event.target.value)} />
          </label>
          <label className="field farmer-form-span">
            Crops grown
            <select
              multiple
              value={activeFarm.crops}
              onChange={(event) => onActiveFarmChange("crops", Array.from(event.target.selectedOptions, (option) => option.value))}
            >
              {cropOptions.map((crop) => (
                <option key={crop} value={crop}>
                  {crop}
                </option>
              ))}
            </select>
            <span className="field-note">Use Ctrl/Cmd-click to select multiple crops.</span>
          </label>
          <label className="field farmer-form-span">
            Farm notes
            <textarea
              rows={3}
              value={activeFarm.notes}
              onChange={(event) => onActiveFarmChange("notes", event.target.value)}
              placeholder="Land access, labor bottlenecks, or any context worth tracking."
            />
          </label>
        </div>

        <label className="toggle">
          <input type="checkbox" checked={activeFarm.hasWaterAccess} onChange={(event) => onActiveFarmChange("hasWaterAccess", event.target.checked)} />
          <span>Water access available on this farm</span>
        </label>
      </section>

      <section className="farmer-card">
        <div className="farmer-card-header">
          <div>
            <div className="label">Starter targets</div>
            <h3>Capture the season plan before advanced setup</h3>
          </div>
          <NavLink to="/dashboard/farm/manage" className="btn ghost small">
            <Icon name="farm" size={14} />
            Open advanced fields
          </NavLink>
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
      </section>
    </>
  );
}
