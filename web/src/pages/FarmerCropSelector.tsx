type FarmerCropSelectorProps = {
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
};

export default function FarmerCropSelector({ options, selected, onChange }: FarmerCropSelectorProps) {
  const selectedSet = new Set(selected);

  const toggleCrop = (crop: string, checked: boolean) => {
    if (checked) {
      onChange([...selected, crop]);
      return;
    }
    onChange(selected.filter((item) => item !== crop));
  };

  return (
    <div className="crop-checkbox-grid" role="group" aria-label="Crops grown">
      {options.map((crop) => (
        <label key={crop} className={`crop-checkbox-item ${selectedSet.has(crop) ? "selected" : ""}`}>
          <input type="checkbox" checked={selectedSet.has(crop)} onChange={(event) => toggleCrop(crop, event.target.checked)} />
          <span>{crop}</span>
        </label>
      ))}
    </div>
  );
}
