import type { ProductObservation } from "./schemas";

/** Empty form values do not require loading the request-validation schemas. */
export function emptyObservation(): ProductObservation {
  return {
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
  };
}
