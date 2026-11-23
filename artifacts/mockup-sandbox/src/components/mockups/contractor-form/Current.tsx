import { useState } from 'react';
import { Check, X } from 'lucide-react';
import './_group.css';

type ContractorField = { key: string; label: string; type?: 'textarea'; full?: boolean };

const contractorFields: ContractorField[] = [
  { key: 'name', label: 'Contractor name', full: true },
  { key: 'aliases', label: 'Aliases', type: 'textarea', full: true },
];

function ContractorRecordModal({ onClose }: { onClose: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({ name: '', aliases: '' });
  const [previewNotice, setPreviewNotice] = useState('');
  const titleId = 'modal-title-contractor';

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="modal" aria-labelledby={titleId} onSubmit={(event) => {
        event.preventDefault();
        setPreviewNotice('Preview only — this form is not connected to Grist, so nothing was saved.');
      }}>
        <div className="modal-head">
          <div>
            <div className="eyebrow">Grist-backed record</div>
            <h2 className="modal-title" id={titleId}>Add contractor</h2>
          </div>
          <button type="button" className="close-btn" onClick={onClose} aria-label="Close"><X /></button>
        </div>
        <div className="modal-body">
          <div className="form-grid">
            {contractorFields.map((field) => (
              <div className={`form-field ${field.full ? 'full' : ''}`} key={field.key}>
                <label htmlFor={`contractor-${field.key}`}>{field.label}</label>
                {field.type === 'textarea'
                  ? <textarea className="field" id={`contractor-${field.key}`} value={values[field.key]} onChange={(event) => setValues({ ...values, [field.key]: event.target.value })} />
                  : <input className="field" id={`contractor-${field.key}`} type="text" required={field.key === 'name'} value={values[field.key]} onChange={(event) => setValues({ ...values, [field.key]: event.target.value })} />}
              </div>
            ))}
          </div>
          {previewNotice && <div className="preview-notice" role="status">{previewNotice}</div>}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary"><Check /> Save record</button>
        </div>
      </form>
    </div>
  );
}

export function Current() {
  const [open, setOpen] = useState(true);
  return (
    <main className="contractor-template-stage">
      {open
        ? <ContractorRecordModal onClose={() => setOpen(false)} />
        : <div className="reopen-shell"><button className="btn btn-primary" onClick={() => setOpen(true)}>Open contractor entry form</button></div>}
    </main>
  );
}
