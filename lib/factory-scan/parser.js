"use client";

import {
  FACTORY_MODULES,
  buildFactoryRoute,
  getWorkflowForModule,
  normalizeFactoryModule,
} from "@/lib/factory-scan/config";

function normalizeKey(key) {
  return String(key)
    .trim()
    .replace(/[\s_-]+(.)?/g, (_, ch) => (ch ? ch.toUpperCase() : ""))
    .replace(/^(.)/, (ch) => ch.toLowerCase());
}

function coerceValue(value) {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();

  if (trimmed === "") {
    return "";
  }

  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }

  if (trimmed === "true") {
    return true;
  }

  if (trimmed === "false") {
    return false;
  }

  return trimmed;
}

function parseDelimitedPayload(rawValue) {
  const payload = {};
  const segments = String(rawValue).split(/[;|,]+/);

  for (const segment of segments) {
    const [rawKey, ...rest] = segment.split(/[:=]/);

    if (!rawKey || rest.length === 0) {
      continue;
    }

    const key = normalizeKey(rawKey);
    payload[key] = coerceValue(rest.join(":"));
  }

  return payload;
}

export function parseFactoryScan(rawValue, fallbackModule) {
  if (typeof rawValue !== "string") {
    throw new Error("Scan data must be a string.");
  }

  const raw = rawValue.trim();

  if (!raw) {
    throw new Error("Scan data is empty.");
  }

  let payload;

  if (raw.startsWith("{") && raw.endsWith("}")) {
    try {
      payload = JSON.parse(raw);
    } catch (error) {
      throw new Error("Scanned JSON payload is invalid.");
    }
  } else {
    payload = parseDelimitedPayload(raw);
  }

  const currentModule = normalizeFactoryModule(
    payload.currentModule || payload.module || fallbackModule,
  );
  const workflow = getWorkflowForModule(currentModule);
  const orderNo = payload.orderNo ?? payload.order ?? payload.poNo ?? null;
  const itcd = payload.itcd ?? payload.itemCode ?? payload.itemId ?? null;
  const productionPlanId =
    payload.productionPlanId ?? payload.procOrdNo ?? payload.processOrder ?? null;

  if (!orderNo && !productionPlanId && !itcd && !payload.code) {
    throw new Error(
      "Scan format is unsupported. Expected JSON or key/value pairs with orderNo, itcd, productionPlanId, or code.",
    );
  }

  return {
    raw,
    code: payload.code ?? raw,
    meta: payload,
    currentModule,
    orderNo,
    itcd,
    batchNo: payload.batchNo ?? payload.batch ?? null,
    receivedQty: payload.receivedQty ?? payload.qty ?? null,
    remarks: payload.remarks ?? null,
    productionPlanId,
    route: buildFactoryRoute(currentModule, {
      orderNo,
      itcd,
      productionPlanId,
    }),
    workflow,
    sourceType:
      currentModule === FACTORY_MODULES.PRODUCTION
        ? "production"
        : currentModule === FACTORY_MODULES.LAB
          ? "lab"
          : currentModule,
  };
}
