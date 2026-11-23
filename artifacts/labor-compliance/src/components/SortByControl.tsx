import type { SortOption } from "../lib/sorting";

export function SortByControl({
  value,
  onChange,
  options,
  label = "Sort by",
}: {
  value: string;
  onChange: (value: string) => void;
  options: SortOption[];
  label?: string;
}) {
  return (
    <label className="sort-by-control">
      <span>{label}</span>
      <select
        className="field select-field"
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}
