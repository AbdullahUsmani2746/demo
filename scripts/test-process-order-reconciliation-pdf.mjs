import fs from "fs";
import path from "path";

async function run() {
  const baseUrl = process.env.BASE_URL || "http://localhost:3000";
  const strictData = process.env.STRICT_DATA === "1";
  const dateFrom = process.argv[2] || "2025-12-01";
  const dateTo = process.argv[3] || "2025-12-31";

  const dataUrl = `${baseUrl}/api/reports/processOrderReconciliation?dateFrom=${encodeURIComponent(dateFrom)}&dateTo=${encodeURIComponent(dateTo)}&limit=2000&page=1`;
  const pdfUrl = `${baseUrl}/api/reports/processOrderReconciliation/pdf?dateFrom=${encodeURIComponent(dateFrom)}&dateTo=${encodeURIComponent(dateTo)}`;

  const dataRes = await fetch(dataUrl);
  if (!dataRes.ok) throw new Error(`Data endpoint failed: ${dataRes.status}`);
  const dataJson = await dataRes.json();

  const pdfRes = await fetch(pdfUrl);
  if (!pdfRes.ok) throw new Error(`PDF endpoint failed: ${pdfRes.status}`);
  const pdfArrayBuffer = await pdfRes.arrayBuffer();
  const pdfBytes = Buffer.from(pdfArrayBuffer);

  const outDir = path.join(process.cwd(), "tmp");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `process-order-reconciliation-${dateFrom}-to-${dateTo}.pdf`);
  fs.writeFileSync(outPath, pdfBytes);

  const text = pdfBytes.toString("latin1");
  const pageMatches = text.match(/\/Type\s*\/Page\b/g) || [];

  const baseChecks = {
    pdfCreated: fs.existsSync(outPath) && fs.statSync(outPath).size > 0,
    hasHeader: text.includes("PROCESS ORDER RECONCILIATION"),
    hasPageMarkers: pageMatches.length >= 1,
  };
  const hasApiGroupingData = Array.isArray(dataJson.data) && dataJson.data.some((r) => r.process_order_no);
  const hasProcessOrderRows = text.includes("Process Order") && text.includes("Process Order Total");
  const checks = strictData
    ? {
      ...baseChecks,
      hasApiGroupingData,
      hasProcessOrderRows,
    }
    : baseChecks;



  if (!strictData && !hasApiGroupingData) {

  }


  if (!Object.values(checks).every(Boolean)) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error("Verification failed:", error);
  process.exit(1);
});
