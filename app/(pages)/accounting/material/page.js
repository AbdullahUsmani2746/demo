"use client";
// Lab: one page, one tab at a time, picked by ?tab= from the sidebar's LAB menu
// (bom, recipe, machine, production, production-plan, grand-master-bom,
// material-usage-bom, future-costing, future-costing-bom-view). Each tab draws
// its own header (components/Material/shared/LabUI.jsx); this is only the frame.
import React, { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";

import BOMTab from "@/components/Material/Bom/BOMTab";
import ProductionTab from "@/components/Material/Production/ProductionTab";
import RecipeTab from "@/components/Material/Recipe/RecipeTab";
import MachineTab from "@/components/Material/Machine/MachineTab";
import GrandMasterBOM from "@/components/Material/Bom/GrandMasterBOM";
import MaterialUsageBOM from "@/components/Material/Bom/MaterialUsageBOM";
import ProductionPlanTab from "@/components/Material/ProductionPlan/ProductionPlanTab";
import FutureCosting from "@/components/Material/Bom/FutureCosting";
import FutureCostingBOMView from "@/components/Material/Bom/FutureCostingBOMView";

const Material = () => {
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState("bom");

  useEffect(() => {
    if (tabParam) {
      setActiveTab(tabParam);
    }
  }, [tabParam]);

  return (
    <div className="min-h-screen bg-muted/40">
      <div className="mx-auto max-w-[1600px] px-3 py-5 sm:px-6">
        {activeTab === "bom" && <BOMTab />}
        {activeTab === "production" && <ProductionTab />}
        {activeTab === "recipe" && <RecipeTab />}
        {activeTab === "machine" && <MachineTab />}
        {activeTab === "production-plan" && <ProductionPlanTab />}
        {activeTab === "grand-master-bom" && <GrandMasterBOM />}
        {activeTab === "material-usage-bom" && <MaterialUsageBOM />}
        {activeTab === "future-costing" && <FutureCosting />}
        {activeTab === "future-costing-bom-view" && <FutureCostingBOMView />}
      </div>
    </div>
  );
};

export default Material;
