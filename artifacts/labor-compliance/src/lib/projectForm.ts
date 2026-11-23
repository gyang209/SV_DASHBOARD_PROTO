export type ProjectFormField = {
  key: string;
  type?: string;
  keepStatusDate?: boolean;
  keepPwcDates?: boolean;
};

export const DIR_NUMBER_PATTERN = "[0-9]{6}|[0-9]{11}";

export function isValidDirNumber(value: string): boolean {
  return value === "" || /^[0-9]{6}(?:[0-9]{5})?$/.test(value);
}

export const projectCodeFormats: Record<
  string,
  { label: string; dirNumberLength?: number; singleDigitCount?: number }
> = {
  TR: { label: "Traffic (TR)", dirNumberLength: 11 },
  ST: { label: "Street (ST)", dirNumberLength: 11 },
  UY: { label: "Utility (UY)", dirNumberLength: 11 },
  UW: { label: "UW", dirNumberLength: 6 },
  PR: { label: "PR", dirNumberLength: 11 },
  PA: { label: "PA", singleDigitCount: 7 },
  OR: { label: "OR", singleDigitCount: 7 },
};

export function formatProjectNumberForDisplay(value: unknown): string {
  const original = String(value ?? "").trim();
  if (!original) return "";

  const segmentedTypes = "TR|ST|SR|UY|UW|PR";
  const separated = new RegExp(
    `^(${segmentedTypes})\\s*(?:-\\s*)?(\\d{1,2})(?:\\s*-\\s*|\\s+)(\\d{1,2})$`,
    "i",
  ).exec(original);
  const compact = new RegExp(
    `^(${segmentedTypes})\\s*-?\\s*(\\d{4})$`,
    "i",
  ).exec(original);

  if (separated || compact) {
    const match = separated ?? compact!;
    const category = match[1].toUpperCase() === "SR" ? "ST" : match[1].toUpperCase();
    const first = separated ? match[2].padStart(2, "0") : match[2].slice(0, 2);
    const second = separated ? match[3].padStart(2, "0") : match[2].slice(2);
    return `${category} - ${first} - ${second}`;
  }

  const single = /^(PA|OR)\s*-?\s*(\d{1,7})$/i.exec(original);
  if (single) return `${single[1].toUpperCase()} - ${single[2].padStart(7, "0")}`;

  return original;
}

export function coerceFields(
  data: Record<string, any>,
  fields: ProjectFormField[],
) {
  const out: Record<string, any> = {};
  fields.forEach(({ key, type, keepStatusDate, keepPwcDates }) => {
    const value = data[key];
    if (type === "projectCode") {
      const category = String(data.projectCodeType ?? "");
      const first = String(data.projectNumberPart1 ?? "");
      const second = String(data.projectNumberPart2 ?? "");
      const single = String(data.projectNumberSingle ?? "");
      const format = projectCodeFormats[category];
      out.projectNumber = format?.singleDigitCount
        ? category && single
          ? `${category} - ${single}`
          : String(value ?? "")
        : category && first && second
          ? `${category} - ${first} - ${second}`
          : String(value ?? "");
    } else if (type === "dirNumberEither") {
      out.dirNumber = String(value ?? "").replace(/\D/g, "");
    } else if (type === "dirNumber") {
      const category = String(data.projectCodeType ?? "");
      const format = projectCodeFormats[category];
      out.dirNumber = format?.dirNumberLength
        ? String(value ?? "").replace(/\D/g, "")
        : String(value ?? "");
    } else if (type === "lcpStatus") {
      out.registrationStatus =
        value === "Yes" ? "Registered" : value === "No" ? "Missing" : "Not checked";
      out.registrationCheckedOn =
        value === "Yes" || keepStatusDate
          ? data.registrationCheckedOn || null
          : null;
    } else if (type === "dirStatus") {
      out.payrollFormsStatus =
        value === "Yes" ? "Complete" : value === "No" ? "Missing" : "Not checked";
      out.payrollFormsCheckedOn =
        value === "Yes" || keepStatusDate
          ? data.payrollFormsCheckedOn || null
          : null;
    } else if (type === "pwc100") {
      const checked = value === true;
      out.pwc100 = checked;
      out.pwc100RegisteredDate =
        checked || keepPwcDates ? data.pwc100RegisteredDate || null : null;
      out.pwc100ExpirationDate =
        checked || keepPwcDates ? data.pwc100ExpirationDate || null : null;
    } else if (type === "projectFlags") {
      out.federalProject = data.federalProject === true;
      out.designProject = data.designProject === true;
      out.onCall = data.onCall === true;
      out.pasCipDpw = data.pasCipDpw === true;
    } else if (type === "number") out[key] = value === "" || value === undefined ? null : Number(value);
    else if (type === "checkbox") out[key] = value === true;
    else if (type === "project" || type === "contractor") out[key] = value === "" || value === undefined ? null : Number(value);
    else if (type === "date") out[key] = value === "" || value === undefined ? null : value;
    else out[key] = value ?? "";
  });
  return out;
}
