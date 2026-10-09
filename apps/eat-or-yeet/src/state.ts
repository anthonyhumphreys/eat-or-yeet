export type Region = "UK" | "US";
export type ToolName = "check_product" | "search_warnings" | "get_warning" | "get_coverage";

export type ProductDraft = {
  productName: string;
  brand: string;
  barcode: string;
  batchCode: string;
  lotCode: string;
  useBy: string;
  bestBefore: string;
};

export type SubmittedObservation = {
  productName: string | null;
  brand: string | null;
  barcode: string | null;
  batchCode: string | null;
  lotCode: string | null;
  producer: string | null;
  farmCode: string | null;
  countryOfOrigin: string | null;
  establishmentNumber: string | null;
  approvalNumber: string | null;
  retailer: string | null;
  category: string | null;
  eggMark: { farmingMethod: string | null; country: string | null; producerCode: string | null } | null;
  dates: { useBy: string | null; bestBefore: string | null; productionDate: string | null } | null;
};

export type CheckInput = {
  region: Region;
  observation: SubmittedObservation;
};

export type CompletedResult = {
  tool: ToolName;
  input: unknown;
  result: unknown;
};

export type RequestState = {
  pending: { id: number; tool: ToolName } | null;
  completed: CompletedResult | null;
  message: string;
  tone: "neutral" | "error" | "success";
};

export const emptyDraft = (): ProductDraft => ({
  productName: "",
  brand: "",
  barcode: "",
  batchCode: "",
  lotCode: "",
  useBy: "",
  bestBefore: "",
});

export const emptySubmittedObservation = (): SubmittedObservation => ({
  productName: null,
  brand: null,
  barcode: null,
  batchCode: null,
  lotCode: null,
  producer: null,
  farmCode: null,
  countryOfOrigin: null,
  establishmentNumber: null,
  approvalNumber: null,
  retailer: null,
  category: null,
  eggMark: null,
  dates: null,
});

export function validCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthLengths = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= monthLengths[month - 1];
}

export function normalizeGtin(value: string): string {
  return value.replace(/[\s-]/g, "");
}

export function makeCheckInput(
  draft: ProductDraft,
  region: Region,
  isValidGtin: (value: string) => boolean,
  submitted: SubmittedObservation = emptySubmittedObservation(),
):
  | { ok: true; value: CheckInput }
  | { ok: false; message: string } {
  const barcode = normalizeGtin(draft.barcode.trim());
  if (barcode && !isValidGtin(barcode)) return { ok: false, message: "Enter a valid GTIN barcode, or clear the field." };
  if (draft.useBy && !validCalendarDate(draft.useBy)) return { ok: false, message: "Use-by must be a real date in YYYY-MM-DD format." };
  if (draft.bestBefore && !validCalendarDate(draft.bestBefore)) return { ok: false, message: "Best-before must be a real date in YYYY-MM-DD format." };
  const dates = submitted.dates || draft.useBy || draft.bestBefore ? {
    useBy: draft.useBy || null,
    bestBefore: draft.bestBefore || null,
    productionDate: submitted.dates?.productionDate ?? null,
  } : null;
  const observation: SubmittedObservation = {
    ...submitted,
    productName: nullable(draft.productName),
    brand: nullable(draft.brand),
    barcode: barcode || null,
    batchCode: nullable(draft.batchCode),
    lotCode: nullable(draft.lotCode),
    dates,
  };
  const hasSubmittedFact = Object.entries(observation).some(([key, value]) => key === "eggMark" || key === "dates"
    ? isRecord(value) && Object.values(value).some((fact) => typeof fact === "string" && fact.trim())
    : typeof value === "string" && value.trim());
  if (!hasSubmittedFact) {
    return { ok: false, message: "Add a barcode or a label detail before checking." };
  }
  return { ok: true, value: { region, observation } };
}

function nullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 300) : null;
}

export function initialRequestState(): RequestState {
  return { pending: null, completed: null, message: "Enter details from the label, then run a check.", tone: "neutral" };
}

export function beginRequest(state: RequestState, id: number, tool: ToolName): RequestState {
  return { ...state, pending: { id, tool }, message: "Checking the official warning records…", tone: "neutral" };
}

export function commitRequest(state: RequestState, id: number, completed: CompletedResult): RequestState {
  if (state.pending?.id !== id) return state;
  return { pending: null, completed, message: "Request complete.", tone: "success" };
}

export function failRequest(state: RequestState, id: number, message: string): RequestState {
  if (state.pending?.id !== id) return state;
  return { ...state, pending: null, message, tone: "error" };
}

export function cancelRequest(state: RequestState, id: number): RequestState {
  if (state.pending?.id !== id) return state;
  return { ...state, pending: null, message: "Request interrupted. No new result was returned.", tone: "error" };
}

export function regionFromUnknown(value: unknown): Region | null {
  return value === "UK" || value === "US" ? value : null;
}

export function draftFromUnknown(value: unknown): ProductDraft | null {
  if (!isRecord(value)) return null;
  const dates = isRecord(value.dates) ? value.dates : {};
  return {
    productName: stringValue(value.productName),
    brand: stringValue(value.brand),
    barcode: stringValue(value.barcode),
    batchCode: stringValue(value.batchCode),
    lotCode: stringValue(value.lotCode),
    useBy: stringValue(dates.useBy),
    bestBefore: stringValue(dates.bestBefore),
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}
