import type { ReactNode } from "react";

export function RequiredFieldLabel({
  htmlFor,
  children,
}: {
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <label htmlFor={htmlFor}>
      {children}
      <span className="required-mark" aria-hidden="true"> *</span>
      <span className="visually-hidden"> (required)</span>
    </label>
  );
}

export function RequiredFieldsNote() {
  return (
    <p className="required-fields-note">
      <span className="required-mark" aria-hidden="true">*</span> Fields marked with an asterisk are required to save.
    </p>
  );
}
