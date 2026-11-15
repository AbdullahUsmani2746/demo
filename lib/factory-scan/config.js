"use client";

export const FACTORY_MODULES = Object.freeze({
  PURCHASE: "purchase",
  PRODUCTION: "production",
  LAB: "lab",
  STORE: "store",
});

export const FACTORY_WORKFLOWS = Object.freeze({
  [FACTORY_MODULES.PURCHASE]: [FACTORY_MODULES.PURCHASE, "qa"],
  [FACTORY_MODULES.PRODUCTION]: [
    FACTORY_MODULES.PRODUCTION,
    "qa",
    FACTORY_MODULES.STORE,
  ],
  [FACTORY_MODULES.LAB]: [
    FACTORY_MODULES.LAB,
    FACTORY_MODULES.PRODUCTION,
    FACTORY_MODULES.STORE,
  ],
  [FACTORY_MODULES.STORE]: [FACTORY_MODULES.STORE],
});

const MODULE_ALIASES = Object.freeze({
  qa: "qa",
  quality: "qa",
  qualitycontrol: "qa",
  purchase: FACTORY_MODULES.PURCHASE,
  production: FACTORY_MODULES.PRODUCTION,
  lab: FACTORY_MODULES.LAB,
  store: FACTORY_MODULES.STORE,
});

export function normalizeFactoryModule(moduleName) {
  if (!moduleName) {
    return FACTORY_MODULES.PURCHASE;
  }

  const normalized = String(moduleName).trim().toLowerCase();
  return MODULE_ALIASES[normalized] || normalized;
}

export function getWorkflowForModule(moduleName) {
  const currentModule = normalizeFactoryModule(moduleName);
  const workflow = FACTORY_WORKFLOWS[currentModule] || [currentModule];
  const currentIndex = workflow.indexOf(currentModule);

  return {
    currentModule,
    workflow,
    nextModule:
      currentIndex >= 0 && currentIndex < workflow.length - 1
        ? workflow[currentIndex + 1]
        : null,
    remainingSteps:
      currentIndex >= 0 ? workflow.slice(currentIndex + 1) : workflow.slice(1),
  };
}

export function buildFactoryRoute(moduleName, parsedScan) {
  const currentModule = normalizeFactoryModule(moduleName);

  if (currentModule === FACTORY_MODULES.PRODUCTION && parsedScan.productionPlanId) {
    return `/accounting/forms/qualitycontrol/${parsedScan.productionPlanId}`;
  }

  if (currentModule === FACTORY_MODULES.PURCHASE && parsedScan.orderNo) {
    return `/accounting/forms/orderqualitycontrol/${parsedScan.orderNo}${
      parsedScan.itcd ? `?itcd=${parsedScan.itcd}` : ""
    }`;
  }

  if (currentModule === FACTORY_MODULES.LAB && parsedScan.productionPlanId) {
    return `/accounting/material`;
  }

  if (currentModule === FACTORY_MODULES.STORE && parsedScan.orderNo) {
    return `/accounting/forms/orderqualitycontrol/${parsedScan.orderNo}${
      parsedScan.itcd ? `?itcd=${parsedScan.itcd}` : ""
    }`;
  }

  return null;
}
