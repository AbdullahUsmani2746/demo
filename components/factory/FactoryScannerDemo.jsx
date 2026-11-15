"use client";
// Factory scanner screen. The hardware scanner is live on the whole page
// (useFactoryScan → use-scan-detection); the payload field below simulates a
// scan by hand. Left: module, workflow and the scan field. Right: the last
// scan's result (or error) and this session's scan history.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  QrCode,
  ScanLine,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  History,
  Loader2,
  Radio,
  Workflow,
  Copy,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFactoryScan } from "@/hooks/useFactoryScan";
import {
  FACTORY_MODULES,
  FACTORY_WORKFLOWS,
  getWorkflowForModule,
} from "@/lib/factory-scan/config";
import { Chip, CODE_CHIP, LabCard, LabEmpty, LabHeader } from "@/components/Material/shared/LabUI";
import { cn } from "@/lib/utils";

const EXAMPLE_SCANS = {
  [FACTORY_MODULES.PURCHASE]:
    '{"module":"purchase","orderNo":1201,"itcd":8801,"receivedQty":24,"remarks":"scanner intake"}',
  [FACTORY_MODULES.PRODUCTION]:
    '{"module":"production","productionPlanId":301,"itcd":9901,"batchNo":"240501"}',
  [FACTORY_MODULES.LAB]:
    '{"module":"lab","productionPlanId":301,"itcd":9901,"batchNo":"240501"}',
  [FACTORY_MODULES.STORE]:
    '{"module":"store","orderNo":1201,"itcd":8801,"batchNo":"240501"}',
};

const HISTORY_LIMIT = 25;
const STATUS = {
  ok: { tone: "ok", label: "Accepted" },
  bad: { tone: "bad", label: "Failed" },
  dup: { tone: "warn", label: "Duplicate" },
};

const timeOf = (iso) => {
  try {
    return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "";
  }
};

function WorkflowPreview({ moduleName }) {
  const workflow = FACTORY_WORKFLOWS[moduleName] || [moduleName];

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {workflow.map((step, index) => (
        <div key={`${step}-${index}`} className="flex items-center gap-1.5">
          <span
            className={cn(
              "rounded-full px-2.5 py-1 text-[11.5px] font-semibold uppercase",
              step === moduleName ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
            )}
          >
            {step}
          </span>
          {index < workflow.length - 1 ? <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" /> : null}
        </div>
      ))}
    </div>
  );
}

function Field({ label, value, mono }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-muted/30 px-3 py-2">
      <p className="text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("break-all text-sm font-semibold text-foreground", mono && "font-mono text-[13px]")}>{value}</p>
    </div>
  );
}

export default function FactoryScannerDemo() {
  const router = useRouter();
  const [selectedModule, setSelectedModule] = useState(FACTORY_MODULES.PURCHASE);
  const [manualScan, setManualScan] = useState(EXAMPLE_SCANS.purchase);
  // This session's scans, newest first (screen only — nothing is stored).
  const [history, setHistory] = useState([]);

  const pushHistory = (entry) =>
    setHistory((prev) =>
      [{ id: `${Date.now()}-${Math.random()}`, at: new Date().toISOString(), ...entry }, ...prev].slice(0, HISTORY_LIMIT),
    );

  const {
    scannedData,
    currentModule,
    handleScan,
    lastError,
    isProcessing,
    setCurrentModule,
  } = useFactoryScan({
    module: selectedModule,
    onScanSuccess: (result) => {
      const nextTarget = result.nextModule ? ` -> ${result.nextModule}` : "";
      toast.success(`Scan accepted for ${result.currentModule}${nextTarget}`);
      pushHistory({ status: "ok", module: result.currentModule, code: result.code, message: result.nextModule ? `Next: ${result.nextModule}` : "Completed" });

      if (result.workflowResult?.endpoint && result.currentModule !== FACTORY_MODULES.LAB) {
        router.prefetch?.(result.workflowResult.endpoint);
      }
    },
    onScanError: (error) => {
      toast.error(error.message);
      pushHistory({ status: "bad", module: error.currentModule, code: error.rawValue, message: error.message });
    },
  });

  const activeWorkflow = useMemo(
    () => getWorkflowForModule(selectedModule),
    [selectedModule],
  );

  const applyModule = (moduleName) => {
    setSelectedModule(moduleName);
    setCurrentModule(moduleName);
    setManualScan(EXAMPLE_SCANS[moduleName]);
  };

  const handleManualSubmit = async () => {
    const result = await handleScan(manualScan);

    if (result?.ignored) {
      pushHistory({ status: "dup", module: currentModule, code: manualScan.trim(), message: "Same scan within a moment — ignored" });
    }

    if (result?.route) {
      toast.info(`Suggested route: ${result.route}`);
    }
  };

  const copyResult = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(scannedData?.workflowResult, null, 2));
      toast.success("Workflow result copied");
    } catch {
      toast.error("Could not copy");
    }
  };

  return (
    <div className="space-y-4">
      <LabHeader
        icon={QrCode}
        breadcrumb="Factory"
        title="Factory Scanner"
        subtitle="Scan a barcode / QR, or paste a payload to test the workflow"
        actions={
          <>
            <Chip tone="brand" className="uppercase">Active: {currentModule}</Chip>
            <Chip tone="muted">Next: {activeWorkflow.nextModule || "completed"}</Chip>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-5">
        {/* Scan */}
        <div className="space-y-4 lg:col-span-3">
          <LabCard title="Scan" icon={ScanLine} bodyClassName="space-y-4 p-4">
            {/* Scanner live */}
            <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5">
              <span className="relative flex h-3 w-3 flex-shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/50" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-primary" />
              </span>
              <p className="text-sm text-foreground">
                <span className="font-semibold">Scanner input is active on this page.</span>{" "}
                <span className="text-muted-foreground">Scan directly with the hardware scanner, or use the field below to simulate a barcode/QR payload.</span>
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-[13px]">Current module</Label>
                <Select value={selectedModule} onValueChange={applyModule}>
                  <SelectTrigger className="h-10">
                    <SelectValue placeholder="Select module" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={FACTORY_MODULES.PURCHASE}>Purchase</SelectItem>
                    <SelectItem value={FACTORY_MODULES.PRODUCTION}>Production</SelectItem>
                    <SelectItem value={FACTORY_MODULES.LAB}>Lab</SelectItem>
                    <SelectItem value={FACTORY_MODULES.STORE}>Store</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-[13px]">
                  <Workflow className="h-3.5 w-3.5 text-primary" />
                  Workflow
                </Label>
                <div className="flex min-h-10 items-center rounded-md border border-border px-3 py-2">
                  <WorkflowPreview moduleName={selectedModule} />
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="factory-scan-payload" className="text-[13px]">Manual test payload</Label>
              <div className="relative">
                <ScanLine className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-primary" />
                <Input
                  id="factory-scan-payload"
                  value={manualScan}
                  onChange={(event) => setManualScan(event.target.value)}
                  placeholder='{"module":"purchase","orderNo":1201,"itcd":8801}'
                  className="h-14 pl-11 font-mono text-[13px] sm:text-sm"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            </div>

            <Button onClick={handleManualSubmit} disabled={isProcessing} size="lg" className="w-full sm:w-auto">
              {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ScanLine className="mr-2 h-4 w-4" />}
              {isProcessing ? "Processing..." : "Process Scan"}
            </Button>
          </LabCard>
        </div>

        {/* Result + history */}
        <div className="space-y-4 lg:col-span-2">
          {lastError ? (
            <section className="overflow-clip rounded-xl border border-destructive/30 bg-background">
              <div className="flex items-start gap-3 bg-destructive/5 px-4 py-3">
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
                  <AlertTriangle className="h-4 w-4" />
                </span>
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-semibold text-destructive">Last scan error</p>
                  <p className="text-sm text-foreground">{lastError.message}</p>
                  {lastError.rawValue ? (
                    <p className="break-all font-mono text-xs text-muted-foreground">{lastError.rawValue}</p>
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}

          <LabCard
            title="Latest scan"
            icon={CheckCircle2}
            actions={scannedData ? <Chip tone="ok">{timeOf(scannedData.scannedAt)}</Chip> : null}
            bodyClassName="p-4"
          >
            {scannedData ? (
              <div className="space-y-3 text-sm">
                <div className="grid gap-2 sm:grid-cols-2">
                  <Field label="Module" value={scannedData.currentModule} />
                  <Field label="Next step" value={scannedData.nextModule || "No next step"} />
                  <div className="sm:col-span-2">
                    <Field label="Scanned code" value={scannedData.code} mono />
                  </div>
                  <div className="sm:col-span-2">
                    <Field label="Suggested route" value={scannedData.route || "No route"} mono />
                  </div>
                </div>

                <div className="rounded-lg border border-border">
                  <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
                    <p className="text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground">Workflow result</p>
                    <Button variant="ghost" size="sm" className="h-7 px-2" onClick={copyResult}>
                      <Copy className="mr-1 h-3.5 w-3.5" />
                      Copy
                    </Button>
                  </div>
                  <pre className="max-h-64 overflow-auto p-3 text-xs text-muted-foreground">
                    {JSON.stringify(scannedData.workflowResult, null, 2)}
                  </pre>
                </div>
              </div>
            ) : (
              <LabEmpty icon={Radio} title="Waiting for a scan" hint="Scan a label or press Process Scan to test the payload." />
            )}
          </LabCard>

          <LabCard
            title="History"
            subtitle="This session only"
            icon={History}
            actions={
              history.length > 0 ? (
                <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setHistory([])}>
                  Clear
                </Button>
              ) : null
            }
          >
            {history.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">No scans yet.</p>
            ) : (
              <ul className="max-h-[420px] divide-y divide-border overflow-y-auto">
                {history.map((h) => (
                  <li key={h.id} className="flex items-start gap-3 px-4 py-2.5">
                    <Chip tone={STATUS[h.status].tone} className="mt-0.5 flex-shrink-0">{STATUS[h.status].label}</Chip>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        {h.module && <span className="text-[12px] font-semibold uppercase text-foreground">{h.module}</span>}
                        <span className="text-[11.5px] tabular-nums text-muted-foreground">{timeOf(h.at)}</span>
                      </div>
                      {h.code && <p className={cn(CODE_CHIP, "mt-1 inline-block max-w-full truncate align-top")}>{h.code}</p>}
                      {h.message && <p className="mt-0.5 text-xs text-muted-foreground">{h.message}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </LabCard>
        </div>
      </div>
    </div>
  );
}
