export function buildQualityControlBarcode({ id, procOrdNo }) {
  const idPart = String(id).padStart(6, "0");
  const procPart = String(procOrdNo).padStart(6, "0");

  return `QC-${procPart}-${idPart}`;
}
