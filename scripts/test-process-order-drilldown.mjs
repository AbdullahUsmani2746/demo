async function run() {
  const baseUrl = process.env.BASE_URL || "http://localhost:3000";
  const dateFrom = process.argv[2] || "2000-01-01";
  const dateTo = process.argv[3] || "2099-12-31";

  const listUrl = `${baseUrl}/api/reports/processOrderReconciliation?page=1&limit=1&dateFrom=${encodeURIComponent(dateFrom)}&dateTo=${encodeURIComponent(dateTo)}`;
  const listRes = await fetch(listUrl);
  if (!listRes.ok) throw new Error(`List endpoint failed: ${listRes.status}`);
  const listJson = await listRes.json();

  const first = listJson?.data?.[0];
  if (!first?.process_order_no) throw new Error("No data available to validate drilldown");

  const processOrderId = first.process_order_no;
  const detailsRes = await fetch(
    `${baseUrl}/api/reports/processOrderReconciliation/${processOrderId}?dateFrom=${encodeURIComponent(dateFrom)}&dateTo=${encodeURIComponent(dateTo)}`,
  );
  if (!detailsRes.ok) throw new Error(`Details endpoint failed: ${detailsRes.status}`);
  const detailsJson = await detailsRes.json();

  const block = detailsJson.processOrder;
  if (!block) throw new Error("Details endpoint missing processOrder payload");

  const totals = (block.items || []).reduce(
    (acc, item) => {
      acc.issuance += Number(item.issuance || 0);
      acc.production += Number(item.production || 0);
      acc.variance += Number(item.variance || 0);
      return acc;
    },
    { issuance: 0, production: 0, variance: 0 }
  );

  const diff = (a, b) => Math.abs(Number(a || 0) - Number(b || 0));
  const totalOk =
    diff(totals.issuance, block.totals?.issuance) < 0.001 &&
    diff(totals.production, block.totals?.production) < 0.001 &&
    diff(totals.variance, block.totals?.variance) < 0.001;

  const pdfRes = await fetch(
    `${baseUrl}/api/reports/processOrderReconciliation/${processOrderId}/pdf?dateFrom=${encodeURIComponent(dateFrom)}&dateTo=${encodeURIComponent(dateTo)}`,
  );
  const excelRes = await fetch(
    `${baseUrl}/api/reports/processOrderReconciliation/${processOrderId}/excel?dateFrom=${encodeURIComponent(dateFrom)}&dateTo=${encodeURIComponent(dateTo)}`,
  );

  const pdfOk =
    pdfRes.ok &&
    (pdfRes.headers.get("content-type") || "").includes("application/pdf");
  const excelOk =
    excelRes.ok &&
    (excelRes.headers.get("content-type") || "").includes(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );

  const checks = {
    totalOk,
    pdfOk,
    excelOk,
  };

  
  

  if (!Object.values(checks).every(Boolean)) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("Drilldown verification failed:", err);
  process.exit(1);
});
