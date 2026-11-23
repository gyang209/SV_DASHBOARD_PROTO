import { useState } from "react";
import { Plus } from "lucide-react";
import type { Contractor } from "@workspace/api-client-react";

type Props = {
  contractors: Contractor[];
  value: string;
  onChange: (value: string) => void;
  onCreate: (name: string) => Promise<Contractor>;
  ariaLabel: string;
  id?: string;
  placeholder?: string;
  newNameLabel?: string;
  buttonLabel?: string;
  compact?: boolean;
};

export function ContractorSelectWithAdd({
  contractors,
  value,
  onChange,
  onCreate,
  ariaLabel,
  id,
  placeholder = "Select primary contractor…",
  newNameLabel = "New primary contractor name",
  buttonLabel = "Add Primary Contractor",
  compact = false,
}: Props) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const sortedContractors = [...contractors].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
  );

  const add = async () => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setError("");
    try {
      const contractor = await onCreate(trimmed);
      onChange(String(contractor.id));
      setName("");
      setAdding(false);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not add this contractor.");
    } finally {
      setSaving(false);
    }
  };

  return <div className={`primary-contractor-field${compact ? " is-compact" : ""}`}>
    <button type="button" className="btn primary-contractor-add-button" aria-expanded={adding} onClick={() => {
      setAdding((open) => !open);
      setError("");
    }}>{adding ? "Cancel Add Contractor" : <><Plus aria-hidden="true" />{buttonLabel}</>}</button>
    {adding && <div className="primary-contractor-inline-add">
      <input className="field" aria-label={newNameLabel} value={name} onChange={(event) => setName(event.target.value)} placeholder="Primary contractor name" onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void add();
        }
      }} />
      <button type="button" className="btn btn-primary" disabled={saving || !name.trim()} onClick={() => void add()}>{saving ? "Adding…" : "Add"}</button>
    </div>}
    {error && <div className="form-error" role="alert">{error}</div>}
    <select id={id} className="field" aria-label={ariaLabel} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">{placeholder}</option>
      {sortedContractors.map((contractor) => <option key={contractor.id} value={contractor.id}>{contractor.name}</option>)}
    </select>
  </div>;
}
