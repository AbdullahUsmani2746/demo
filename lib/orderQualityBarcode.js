export function buildQaBarcode({ orderNo, itcd, id }) {
  return `QA-${String(orderNo).padStart(6, "0")}-${String(itcd).padStart(6, "0")}-${String(id).padStart(6, "0")}`;
}

export function buildOrderQcBarcode({ orderNo, itcd, id }) {
  return `QCO-${String(orderNo).padStart(6, "0")}-${String(itcd).padStart(6, "0")}-${String(id).padStart(6, "0")}`;
}
