export function buildProductionBarcode({ id, dated, type }) {
  const dateValue = dated ? new Date(dated) : new Date();
  const year = dateValue.getFullYear();
  const month = String(dateValue.getMonth() + 1).padStart(2, "0");
  const day = String(dateValue.getDate()).padStart(2, "0");
  const idPart = String(id).padStart(6, "0");
  const typePart = String(type || "new").slice(0, 3).toUpperCase();

  return `PRD-${year}${month}${day}-${typePart}-${idPart}`;
}
