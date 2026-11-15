"use client";
import React, { useState, useEffect, useRef } from "react";
import {
  Plus,
  Edit,
  //Trash2,
  Search,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  Save,
  Check,
  Clock,
  Settings,
  Cpu,
  List,
  X,
  BarChart3,
  Loader2,
  Eye,
} from "lucide-react";
import Select from "react-select";
import { toast } from "sonner";
import { useMachineInstructions } from "@/hooks/useMachineInstruction";
import { useBOM } from "@/hooks/useBOM";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { selectStyles } from "@/components/shared/EntityFormPanel";
import {
  LabHeader,
  LabCard,
  LabEmpty,
  Chip,
  CODE_CHIP,
  TH,
  TD,
  NUM,
  TOTAL_ROW,
  DIALOG,
  DIALOG_HEAD,
  DIALOG_BODY,
  DIALOG_FOOT,
} from "@/components/Material/shared/LabUI";

// Form inputs and labels (same look as the other Lab forms).
const INPUT =
  "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15";
const INPUT_ERR = "border-destructive focus:border-destructive focus:ring-destructive/15";
const LABEL = "mb-1.5 block text-[12.5px] font-medium text-foreground";
const FILTER =
  "h-9 rounded-lg border border-input bg-background px-2.5 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15";

// Which field each save-validation message belongs to (shown next to it).
const fieldError = (errors, key) =>
  errors.find((e) =>
    key === "machine_id"
      ? /machine selection/i.test(e)
      : key === "time_min"
        ? /total time/i.test(e)
        : /operation step/i.test(e),
  );

const FieldError = ({ children }) =>
  children ? (
    <p className="mt-1 flex items-center gap-1 text-[12px] text-destructive">
      <AlertCircle className="h-3 w-3 flex-shrink-0" /> {children}
    </p>
  ) : null;

// Machine Instruction Form Component - MOVED OUTSIDE
const MachineInstructionForm = ({
  machineForm,
  handleMachineFormChange,
  machineDetailInput,
  handleDetailInputChange,
  addMachineDetail,
  removeMachineDetail,
  editMachineDetail,
  editingDetailIndex,
  setEditingDetailIndex,
  isEditMode,
  validationErrors,
  machineOptions,
  setMachineDetailInput,
}) => {
  const totalDetailTime = machineForm.machineDetails.reduce(
    (sum, detail) => sum + (parseInt(detail.time_min) || 0),
    0,
  );

  const timeStatus =
    totalDetailTime === machineForm.time_min
      ? "match"
      : totalDetailTime > machineForm.time_min
        ? "exceed"
        : "less";

  const timeChip =
    timeStatus === "match" ? (
      <Chip tone="ok">
        <Check className="h-3 w-3" /> Matches total
      </Chip>
    ) : timeStatus === "exceed" ? (
      <Chip tone="bad">Over by {totalDetailTime - machineForm.time_min}m</Chip>
    ) : (
      <Chip tone="warn">Under by {machineForm.time_min - totalDetailTime}m</Chip>
    );

  const machineLabel = (id) =>
    machineOptions.find((opt) => opt.value === id)?.label;

  const errMachine = fieldError(validationErrors, "machine_id");
  const errTime = fieldError(validationErrors, "time_min");
  const errSteps = fieldError(validationErrors, "steps");

  return (
    <div className="space-y-4">
      {/* Validation summary */}
      {validationErrors.length > 0 && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-destructive">
          <p className="flex items-center gap-2 text-[13px] font-semibold">
            <AlertCircle className="h-4 w-4" /> Please fix the following
          </p>
          <ul className="mt-1 list-inside list-disc text-[12.5px]">
            {validationErrors.map((error, index) => (
              <li key={index}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Machine Setup */}
      <LabCard title="Machine Setup" icon={Settings} bodyClassName="p-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <label className={LABEL}>
              Machine <span className="text-destructive">*</span>
            </label>
            <Select
              value={
                machineOptions.find(
                  (opt) => opt.value === machineForm.machine_id,
                ) || null
              }
              onChange={(selected) =>
                handleMachineFormChange(
                  "machine_id",
                  selected ? selected.value : "",
                )
              }
              options={machineOptions}
              isSearchable
              isClearable
              placeholder="Choose machine..."
              classNamePrefix="react-select"
              menuPosition="fixed"
              styles={selectStyles(!!errMachine)}
            />
            <FieldError>{errMachine}</FieldError>
          </div>

          <div>
            <label className={LABEL}>
              Total Time (min) <span className="text-destructive">*</span>
            </label>
            <div className="relative">
              <Clock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="number"
                value={machineForm.time_min || ""}
                onChange={(e) =>
                  handleMachineFormChange(
                    "time_min",
                    parseInt(e.target.value) || 0,
                  )
                }
                placeholder="0"
                min="0"
                aria-invalid={!!errTime}
                className={`${INPUT} pl-9 text-right tabular-nums ${errTime ? INPUT_ERR : ""}`}
              />
            </div>
            <FieldError>{errTime}</FieldError>
          </div>

          <div className="sm:col-span-2 lg:col-span-1">
            <label className={LABEL}>Steps total</label>
            <div className="flex h-10 items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3">
              <span className="text-sm font-semibold tabular-nums text-foreground">
                {totalDetailTime}m / {machineForm.time_min || 0}m
              </span>
              {machineForm.machineDetails.length > 0 && timeChip}
            </div>
          </div>

          <div className="sm:col-span-2 lg:col-span-4">
            <label className={LABEL}>Description</label>
            <textarea
              value={machineForm.descr}
              onChange={(e) => handleMachineFormChange("descr", e.target.value)}
              placeholder="Enter description..."
              rows={2}
              className={`${INPUT} h-auto resize-y py-2`}
            />
          </div>
        </div>
      </LabCard>

      {/* Operation Steps */}
      <LabCard
        title="Operation Steps"
        subtitle={`${machineForm.machineDetails.length} step${machineForm.machineDetails.length !== 1 ? "s" : ""} · ${totalDetailTime}m of ${machineForm.time_min || 0}m`}
        icon={BarChart3}
        className={errSteps ? "border-destructive/50" : ""}
      >
        {/* Step editor ("add line") */}
        <div
          className={`border-b border-border p-4 ${editingDetailIndex !== null ? "bg-primary/5" : "bg-muted/30"}`}
        >
          <p className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-foreground">
            {editingDetailIndex !== null ? (
              <>
                <Edit className="h-3.5 w-3.5 text-primary" /> Edit step{" "}
                {editingDetailIndex + 1}
              </>
            ) : (
              <>
                <Plus className="h-3.5 w-3.5 text-primary" /> Add operation step
              </>
            )}
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-12 lg:items-end">
            <div className="lg:col-span-3">
              <label className={LABEL}>Machine</label>
              <Select
                value={
                  machineOptions.find(
                    (opt) => opt.value === machineDetailInput.machine_id,
                  ) || null
                }
                onChange={(selected) =>
                  handleDetailInputChange(
                    "machine_id",
                    selected ? selected.value : "",
                  )
                }
                options={machineOptions}
                isSearchable
                isClearable
                placeholder="Select machine..."
                classNamePrefix="react-select"
                menuPosition="fixed"
                styles={selectStyles(false)}
              />
            </div>

            <div className="lg:col-span-3">
              <label className={LABEL}>Part / Operation</label>
              <input
                type="text"
                value={machineDetailInput.part}
                onChange={(e) =>
                  handleDetailInputChange("part", e.target.value)
                }
                placeholder="Enter part name..."
                className={INPUT}
              />
            </div>

            <div className="lg:col-span-2">
              <label className={LABEL}>Time (min)</label>
              <input
                type="number"
                value={machineDetailInput.time_min || ""}
                onChange={(e) =>
                  handleDetailInputChange(
                    "time_min",
                    parseInt(e.target.value) || 0,
                  )
                }
                placeholder="0"
                min="0"
                className={`${INPUT} text-right tabular-nums`}
              />
            </div>

            <div className="lg:col-span-2">
              <label className={LABEL}>Instructions</label>
              <input
                type="text"
                value={machineDetailInput.instructions}
                onChange={(e) =>
                  handleDetailInputChange("instructions", e.target.value)
                }
                placeholder="Instructions..."
                className={INPUT}
              />
            </div>

            <div className="flex gap-2 sm:col-span-2 lg:col-span-2">
              <Button
                type="button"
                onClick={addMachineDetail}
                disabled={!machineDetailInput.machine_id}
                className="h-10 flex-1"
              >
                {editingDetailIndex !== null ? (
                  <>
                    <Save /> Update
                  </>
                ) : (
                  <>
                    <Plus /> Add
                  </>
                )}
              </Button>

              {editingDetailIndex !== null && (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-10 w-10"
                  title="Cancel step edit"
                  aria-label="Cancel step edit"
                  onClick={() => {
                    setEditingDetailIndex(null);
                    setMachineDetailInput({
                      machine_id: "",
                      part: "",
                      time_min: "",
                      instructions: "",
                    });
                  }}
                >
                  <X />
                </Button>
              )}
            </div>
          </div>
        </div>

        {machineForm.machineDetails.length > 0 ? (
          <div className="md:overflow-x-auto">
            <table className="vl-grid w-full text-sm">
              <thead>
                <tr>
                  <th className={`${TH} w-16`}>Step</th>
                  <th className={TH}>Machine</th>
                  <th className={TH}>Part / Operation</th>
                  <th className={`${TH} w-28 text-right`}>Time (min)</th>
                  <th className={TH}>Instructions</th>
                  <th className={`${TH} w-24 text-right`}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {machineForm.machineDetails.map((detail, index) => (
                  <tr
                    key={index}
                    className={`transition-colors ${
                      editingDetailIndex === index
                        ? "bg-primary/10"
                        : "hover:bg-muted/40"
                    }`}
                  >
                    <td data-label="Step" className={TD}>
                      <span
                        className={`flex h-6 w-6 items-center justify-center rounded-full text-[11.5px] font-bold ${
                          editingDetailIndex === index
                            ? "bg-primary text-primary-foreground"
                            : "bg-primary/10 text-primary"
                        }`}
                      >
                        {detail.sno}
                      </span>
                    </td>
                    <td data-label="Machine" className={TD}>
                      <span className={CODE_CHIP}>{detail.machine_id}</span>
                      {machineLabel(detail.machine_id) && (
                        <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">
                          {machineLabel(detail.machine_id).replace(
                            `${detail.machine_id} - `,
                            "",
                          )}
                        </span>
                      )}
                    </td>
                    <td data-label="Part / Operation" className={`${TD} text-foreground`}>
                      {detail.part || "-"}
                    </td>
                    <td data-label="Time (min)" className={`${TD} ${NUM} font-medium`}>
                      {detail.time_min || 0}m
                    </td>
                    <td data-label="Instructions" className={`${TD} text-foreground`}>
                      {detail.instructions || "-"}
                    </td>
                    <td className={`${TD} vl-actions text-right`}>
                      <div className="inline-flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => editMachineDetail(index)}
                          className="h-8 w-8 text-muted-foreground hover:bg-primary/10 hover:text-primary"
                          title="Edit step"
                          aria-label={`Edit step ${detail.sno}`}
                        >
                          <Edit />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeMachineDetail(index)}
                          className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          title="Remove step"
                          aria-label={`Remove step ${detail.sno}`}
                        >
                          <X />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              {/* Totals (phones see them in the card header / Steps total) */}
              <tfoot className="max-md:hidden">
                <tr className={TOTAL_ROW}>
                  <td className={TD} colSpan={3}>
                    Total · {machineForm.machineDetails.length} step
                    {machineForm.machineDetails.length !== 1 ? "s" : ""}
                  </td>
                  <td className={`${TD} ${NUM}`}>
                    {totalDetailTime}m / {machineForm.time_min || 0}m
                  </td>
                  <td className={TD} colSpan={2}>
                    {timeChip}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <LabEmpty
            icon={List}
            title="No operation steps added yet"
            hint={
              errSteps ||
              "Add operation steps above to build your machine instruction"
            }
          />
        )}
      </LabCard>
    </div>
  );
};

// Main MachineTab Component
const MachineTab = () => {
  const [editingDetailIndex, setEditingDetailIndex] = useState(null);
  const [isEditMode, setIsEditMode] = useState(false); // Track if we're editing an existing item
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [pendingDeleteId, setPendingDeleteId] = useState(null); // delete confirmation
  const [validationErrors, setValidationErrors] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ── SEARCH-FIRST UI STATE ──────────────────────────────────────────────────
  const [hasSearched, setHasSearched] = useState(false);
  const [localSearch, setLocalSearch] = useState("");
  // ──────────────────────────────────────────────────────────────────────────

  // Machine state
  const [searchMachine, setSearchMachine] = useState("");
  const [filterMachine, setFilterMachine] = useState("");
  const [machinePage, setMachinePage] = useState(1);
  const [machineLimit, setMachineLimit] = useState(10);
  const [machineSortBy, setMachineSortBy] = useState("rec_id");
  const [machineSortOrder, setMachineSortOrder] = useState("desc");

  const {
    machineInstructions = [],
    loading: machineLoading = false,
    error: machineError,
    createMachineInstruction: createMachineInstructionAPI,
    updateMachineInstruction: updateMachineInstructionAPI,
    deleteMachineInstruction: deleteMachineInstructionAPI,
    total: machineTotal = 0,
    totalPages: machineTotalPages = 1,
    fetchMachineInstructions,
  } = useMachineInstructions({
    searchTerm: searchMachine,
    filterStatus: filterMachine,
    page: machinePage,
    limit: machineLimit,
    sortBy: machineSortBy,
    sortOrder: machineSortOrder,
  });

  const { items: finishItems = [] } = useBOM({}) || {};

  const [machineForm, setMachineForm] = useState({
    machine_id: "",
    time_min: "",
    descr: "",
    machineDetails: [],
  });

  const [machineDetailInput, setMachineDetailInput] = useState({
    machine_id: "",
    part: "",
    time_min: "",
    instructions: "",
  });

  const [recipeUsageModalOpen, setRecipeUsageModalOpen] = useState(false);
  const [selectedMachineForUsage, setSelectedMachineForUsage] = useState(null);
  const [usageRecipes, setUsageRecipes] = useState([]);
  const [loadingUsageRecipes, setLoadingUsageRecipes] = useState(false);

  useEffect(() => {
    if (recipeUsageModalOpen && selectedMachineForUsage) {
      setLoadingUsageRecipes(true);
      fetch(`/api/manufacturing/recipe?machine_id=${selectedMachineForUsage.machine_id}&limit=100`)
        .then(res => res.json())
        .then(data => {
          setUsageRecipes(data.data || []);
          setLoadingUsageRecipes(false);
        })
        .catch(err => {
          console.error("Failed to fetch usage recipes:", err);
          setUsageRecipes([]);
          setLoadingUsageRecipes(false);
        });
    } else {
      setUsageRecipes([]);
    }
  }, [recipeUsageModalOpen, selectedMachineForUsage]);

  const handleMachineFormChange = (field, value) => {
    setMachineForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleDetailInputChange = (field, value) => {
    setMachineDetailInput((prev) => ({
      ...prev,
      [field]: value === "" ? "" : value, // Ensure empty string instead of null
    }));
  };

  // ── DEBOUNCE: localSearch → searchMachine + hasSearched ───────────────────
  useEffect(() => {
    const timer = setTimeout(() => {
      if (localSearch !== searchMachine) {
        setSearchMachine(localSearch);
        setMachinePage(1);
        setHasSearched(localSearch.trim() !== "");
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [localSearch]);
  // ──────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    fetchMachineInstructions();
  }, [
    searchMachine,
    filterMachine,
    machinePage,
    machineLimit,
    machineSortBy,
    machineSortOrder,
  ]);

  const showNotification = (message, type = "success") => {
    if (type === "error") toast.error(message);
    else if (type === "success") toast.success(message);
    else toast.warning(message);
  };

  // Machine Instruction CRUD Operations
  const createMachineInstruction = async () => {
  if (isSubmitting) return;

  setIsSubmitting(true);
  setValidationErrors([]);

  const errors = [];

  if (!machineForm.machine_id)
    errors.push("Machine selection is required");

  if (machineForm.time_min <= 0)
    errors.push("Total time must be greater than 0");

  if (machineForm.machineDetails.length === 0)
    errors.push("At least one operation step is required");

  if (errors.length > 0) {
    setValidationErrors(errors);
    setIsSubmitting(false);
    return;
  }

  try {
    const result = await createMachineInstructionAPI(machineForm);

    if (result.success) {
      closeModal();
      showNotification("Machine instruction created successfully!");
    } else {
      showNotification(
        result.error || "Failed to create machine instruction",
        "error"
      );
    }
  } catch (error) {
    showNotification("Something went wrong", "error");
  } finally {
    setIsSubmitting(false);
  }
};
  // const createMachineInstruction = async () => {
  //   setValidationErrors([]);

  //   const errors = [];
  //   if (!machineForm.machine_id) errors.push("Machine selection is required");
  //   if (machineForm.time_min <= 0)
  //     errors.push("Total time must be greater than 0");
  //   if (machineForm.machineDetails.length === 0)
  //     errors.push("At least one operation step is required");

  //   if (errors.length > 0) {
  //     setValidationErrors(errors);
  //     return;
  //   }

  //   const result = await createMachineInstructionAPI(machineForm);
  //   if (result.success) {
  //     closeModal();
  //     showNotification("Machine instruction created successfully!");
  //   } else {
  //     showNotification(
  //       result.error || "Failed to create machine instruction",
  //       "error",
  //     );
  //   }
  // };
  const updateMachineInstruction = async () => {
  if (isSubmitting) return;

  setIsSubmitting(true);
  setValidationErrors([]);

  const errors = [];

  if (!machineForm.machine_id)
    errors.push("Machine selection is required");

  if (machineForm.time_min <= 0)
    errors.push("Total time must be greater than 0");

  if (machineForm.machineDetails.length === 0)
    errors.push("At least one operation step is required");

  if (errors.length > 0) {
    setValidationErrors(errors);
    setIsSubmitting(false);
    return;
  }

  try {
    const result = await updateMachineInstructionAPI(
      editingItem.rec_id,
      machineForm
    );

    if (result.success) {
      closeModal();
      showNotification("Machine instruction updated successfully!");
    } else {
      showNotification(
        result.error || "Failed to update machine instruction",
        "error"
      );
    }
  } catch (error) {
    showNotification("Something went wrong", "error");
  } finally {
    setIsSubmitting(false);
  }
};

  // const updateMachineInstruction = async () => {
  //   setValidationErrors([]);

  //   const errors = [];
  //   if (!machineForm.machine_id) errors.push("Machine selection is required");
  //   if (machineForm.time_min <= 0)
  //     errors.push("Total time must be greater than 0");
  //   if (machineForm.machineDetails.length === 0)
  //     errors.push("At least one operation step is required");

  //   if (errors.length > 0) {
  //     setValidationErrors(errors);
  //     return;
  //   }

  //   const result = await updateMachineInstructionAPI(
  //     editingItem.rec_id,
  //     machineForm,
  //   );
  //   if (result.success) {
  //     closeModal();
  //     showNotification("Machine instruction updated successfully!");
  //   } else {
  //     showNotification(
  //       result.error || "Failed to update machine instruction",
  //       "error",
  //     );
  //   }
  // };

  // Asks first (AlertDialog below); the delete runs on confirm.
  const deleteMachineInstruction = (id) => setPendingDeleteId(id);

  const confirmDeleteMachineInstruction = async () => {
    const id = pendingDeleteId;
    setPendingDeleteId(null);
    const result = await deleteMachineInstructionAPI(id);
    if (result.success) {
      showNotification("Machine instruction deleted successfully!");
    } else {
      showNotification(
        result.error || "Failed to delete machine instruction",
        "error",
      );
    }
  };

  const removeMachineDetail = (index) => {
    setMachineForm((prev) => ({
      ...prev,
      machineDetails: prev.machineDetails
        .filter((_, i) => i !== index)
        .map((detail, idx) => ({ ...detail, sno: idx + 1 })),
    }));
  };

  // Update the openModal function:
  const openModal = (item = null) => {
    setEditingItem(item);
    setValidationErrors([]);
    setEditingDetailIndex(null); // Reset editing detail index
    setIsEditMode(!!item); // Set edit mode based on whether we're editing

    if (item) {
      setMachineForm({
        machine_id: item.machine_id || "",
        time_min: item.time_min || 0,
        descr: item.descr || "",
        machineDetails:
          item.machineDetails?.map((detail, index) => ({
            ...detail,
            sno: index + 1,
          })) || [],
      });
    } else {
      setMachineForm({
        machine_id: "",
        time_min: 0,
        descr: "",
        machineDetails: [],
      });
    }
    setMachineDetailInput({
      machine_id: "",
      part: "",
      time_min: "",
      instructions: "",
    });
    setShowModal(true);
  };

  // Add function to handle editing of existing detail
  const editMachineDetail = (index) => {
    const detail = machineForm.machineDetails[index];
    setMachineDetailInput({
      machine_id: detail.machine_id || "",
      part: detail.part || "",
      time_min: detail.time_min || "",
      instructions: detail.instructions || "",
    });
    setEditingDetailIndex(index);
  };

  const addMachineDetail = () => {
    if (!machineDetailInput.machine_id) {
      showNotification("Machine ID is required", "error");
      return;
    }

    if (editingDetailIndex !== null) {
      // Update existing detail
      const updatedDetails = [...machineForm.machineDetails];
      updatedDetails[editingDetailIndex] = {
        ...machineDetailInput,
        sno: editingDetailIndex + 1,
      };

      setMachineForm((prev) => ({
        ...prev,
        machineDetails: updatedDetails,
      }));

      setEditingDetailIndex(null);
    } else {
      // Add new detail
      setMachineForm((prev) => ({
        ...prev,
        machineDetails: [
          ...prev.machineDetails,
          {
            ...machineDetailInput,
            sno: prev.machineDetails.length + 1,
          },
        ],
      }));
    }

    // Reset input
    setMachineDetailInput({
      machine_id: "",
      part: "",
      time_min: "",
      instructions: "",
    });
  };

  // Update the closeModal function
  const closeModal = () => {
    setShowModal(false);
    setEditingItem(null);
    setEditingDetailIndex(null);
    setIsEditMode(false);
    setValidationErrors([]);
  };

  const handleMachineSort = (field) => {
    if (machineSortBy === field) {
      setMachineSortOrder(machineSortOrder === "asc" ? "desc" : "asc");
    } else {
      setMachineSortBy(field);
      setMachineSortOrder("asc");
    }
  };

  // "/" focuses the search (Ctrl+K is the header's menu search).
  const searchRef = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      const typing =
        /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) ||
        e.target?.isContentEditable;
      if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const totalPages = Math.max(1, Math.ceil(machineTotal / machineLimit));

  const machineOptions = finishItems
    .filter((cat) => cat.ic_id === 501)
    .map((item) => ({
      value: item.itcd,
      label: `${item.itcd} - ${item.item}`,
    }));

  // Sortable column header (a plain call, not a component, so it isn't remounted).
  const sortTh = (field, children, className = "") => (
    <th className={`${TH} ${className}`}>
      <button
        type="button"
        onClick={() => handleMachineSort(field)}
        className="inline-flex items-center gap-1.5 uppercase hover:opacity-80"
      >
        {children}
        <ArrowUpDown
          className={`h-3 w-3 ${machineSortBy === field ? "opacity-100" : "opacity-50"}`}
        />
      </button>
    </th>
  );

  return (
    <div className="space-y-4">
      <LabHeader
        icon={Cpu}
        title="Machine Instructions"
        subtitle="Configure machine operations and timing sequences"
        badge={machineTotal || null}
        actions={
          <Button onClick={() => openModal()}>
            <Plus /> New Machine Instruction
          </Button>
        }
      />

      <LabCard>
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <label className="flex h-9 min-w-0 flex-1 basis-56 items-center gap-2 rounded-lg border border-input bg-background px-3 text-muted-foreground focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15 sm:max-w-md">
            <Search className="h-4 w-4 flex-shrink-0" />
            <input
              ref={searchRef}
              type="text"
              value={localSearch}
              onChange={(e) => setLocalSearch(e.target.value)}
              placeholder="Search by machine name or ID..."
              aria-label="Search machine instructions"
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
            <kbd className="hidden rounded border border-b-2 border-border px-1.5 font-mono text-[10.5px] sm:inline">
              /
            </kbd>
          </label>
          <select
            value={filterMachine}
            onChange={(e) => setFilterMachine(e.target.value)}
            aria-label="Status"
            className={FILTER}
          >
            <option value="">All Status</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </select>

          <select
            value={machineLimit}
            onChange={(e) => {
              setMachineLimit(Number(e.target.value));
              setMachinePage(1);
            }}
            aria-label="Rows per page"
            className={FILTER}
          >
            <option value={10}>10 per page</option>
            <option value={25}>25 per page</option>
            <option value={50}>50 per page</option>
            <option value={100}>100 per page</option>
          </select>

          {/* Clear button - wapas default view */}
          <Button
            variant="outline"
            size="sm"
            className="h-9"
            onClick={() => {
              setLocalSearch("");
              setSearchMachine("");
              setMachinePage(1);
              setHasSearched(false);
            }}
          >
            <X /> Clear
          </Button>
        </div>

        {machineError && (
          <div className="flex items-center gap-2 border-b border-destructive/20 bg-destructive/5 px-4 py-2.5 text-[13px] text-destructive">
            <AlertCircle className="h-4 w-4 flex-shrink-0" /> {String(machineError)}
          </div>
        )}

        {/* Table — cards under md */}
        <div className="md:max-h-[65vh] md:overflow-auto">
          <table className="vl-grid w-full text-sm">
            <thead>
              <tr>
                {sortTh("rec_id", "ID", "w-20")}
                {sortTh("machine_id", "Machine")}
                <th className={TH}>Recipe Usage</th>
                {sortTh("time_min", "Time", "text-right")}
                <th className={`${TH} text-right`}>Steps</th>
                {sortTh("descr", "Description")}
                <th className={`${TH} w-20 text-right`}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {machineLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={`sk${i}`}>
                    <td colSpan={7} className="px-3 py-3">
                      <Skeleton className="h-6 w-full" />
                    </td>
                  </tr>
                ))
              ) : machineInstructions.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <LabEmpty
                      icon={Cpu}
                      title="No machine instructions found"
                      hint={
                        localSearch
                          ? "Nothing matches this search — try another name or ID."
                          : "Create your first machine instruction to get started."
                      }
                      action={
                        <Button size="sm" className="mt-2" onClick={() => openModal()}>
                          <Plus /> New Machine Instruction
                        </Button>
                      }
                    />
                  </td>
                </tr>
              ) : (
                machineInstructions.map((machine, index) => (
                  <tr
                    key={machine.rec_id ?? index}
                    className="transition-colors hover:bg-muted/40"
                  >
                    <td data-label="ID" className={`${TD} tabular-nums font-semibold text-foreground`}>
                      {machine.rec_id}
                    </td>
                    <td data-label="Machine" className={`${TD} max-md:col-span-2`}>
                      <span className="block max-w-xs truncate font-medium text-foreground">
                        {machine.item?.item || "N/A"}
                      </span>
                      <span className={CODE_CHIP}>{machine.machine_id}</span>
                    </td>
                    <td data-label="Recipe Usage" className={TD}>
                      {machine.machineDetails?.length > 0 ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2.5"
                          onClick={() => {
                            setSelectedMachineForUsage(machine);
                            setRecipeUsageModalOpen(true);
                          }}
                        >
                          <Eye /> View
                        </Button>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                    <td data-label="Time" className={`${TD} ${NUM} whitespace-nowrap`}>
                      <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                        <Clock className="h-3.5 w-3.5 text-primary" />
                        {machine.time_min || 0}m
                      </span>
                    </td>
                    <td data-label="Steps" className={`${TD} ${NUM}`}>
                      <Chip tone={machine.machineDetails?.length ? "brand" : "muted"}>
                        {machine.machineDetails?.length || 0}
                      </Chip>
                    </td>
                    <td data-label="Description" className={`${TD} max-md:col-span-2`}>
                      <span
                        className={`block max-w-xs truncate text-[13px] ${machine.descr ? "text-foreground" : "text-muted-foreground"}`}
                        title={machine.descr || ""}
                      >
                        {machine.descr || "No description"}
                      </span>
                    </td>
                    <td className={`${TD} vl-actions whitespace-nowrap text-right`}>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openModal(machine)}
                        className="h-8 w-8 text-muted-foreground hover:bg-primary/10 hover:text-primary"
                        title="Edit"
                        aria-label={`Edit machine instruction ${machine.rec_id}`}
                      >
                        <Edit />
                      </Button>
                      {/* <Button
                        variant="ghost"
                        size="icon"
                        onClick={() =>
                          deleteMachineInstruction(machine.rec_id)
                        }
                        className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        title="Delete"
                      >
                        <Trash2 />
                      </Button> */}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {machineTotal > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2.5 text-[13px] text-muted-foreground">
            <span className="tabular-nums">
              Showing {(machinePage - 1) * machineLimit + 1}–
              {Math.min(machinePage * machineLimit, machineTotal)} of{" "}
              {machineTotal}
            </span>
            {machineTotal > machineLimit && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setMachinePage(Math.max(1, machinePage - 1))}
                  disabled={machinePage === 1}
                >
                  <ChevronLeft /> Prev
                </Button>
                <span className="tabular-nums text-foreground">
                  Page {machinePage} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setMachinePage(Math.min(totalPages, machinePage + 1))
                  }
                  disabled={machinePage >= totalPages}
                >
                  Next <ChevronRight />
                </Button>
              </div>
            )}
          </div>
        )}
      </LabCard>

      {/* Recipe Usage Modal */}
      <Dialog
        open={recipeUsageModalOpen && !!selectedMachineForUsage}
        onOpenChange={(open) => !open && setRecipeUsageModalOpen(false)}
      >
        <DialogContent className={`${DIALOG} max-w-3xl`}>
          <div className={`${DIALOG_HEAD} pr-14`}>
            <DialogTitle className="flex items-center gap-2 text-base text-primary">
              <List className="h-4 w-4" /> Recipe Usage
            </DialogTitle>
            <DialogDescription className="mt-1 text-[12.5px]">
              Recipes that use{" "}
              <span className={CODE_CHIP}>{selectedMachineForUsage?.machine_id}</span>{" "}
              {selectedMachineForUsage?.item?.item || ""}
            </DialogDescription>
          </div>

          <div className={DIALOG_BODY}>
            {loadingUsageRecipes ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : usageRecipes?.length > 0 ? (
              <div className="overflow-hidden rounded-lg border border-border md:max-h-[60vh] md:overflow-auto">
                <table className="vl-grid w-full text-sm">
                  <thead>
                    <tr>
                      <th className={TH}>Finished ID</th>
                      <th className={TH}>Item Name</th>
                      <th className={TH}>Recipe ID</th>
                      <th className={TH}>Ink Code</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {usageRecipes.map((recipe, index) => (
                      <tr key={index} className="transition-colors hover:bg-muted/40">
                        <td data-label="Finished ID" className={TD}>
                          {recipe.finished_id ? (
                            <span className={CODE_CHIP}>{recipe.finished_id}</span>
                          ) : (
                            "-"
                          )}
                        </td>
                        <td data-label="Item Name" className={`${TD} text-foreground`}>
                          {recipe.item?.item || "-"}
                        </td>
                        <td data-label="Recipe ID" className={`${TD} tabular-nums`}>
                          {recipe.receipe_id || "-"}
                        </td>
                        <td data-label="Ink Code" className={`${TD} font-mono text-[12.5px]`}>
                          {recipe.item?.code || ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <LabEmpty
                icon={List}
                title="No recipes found"
                hint="No recipe uses this machine yet."
              />
            )}
          </div>

          <div className={DIALOG_FOOT}>
            <Button variant="outline" onClick={() => setRecipeUsageModalOpen(false)}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create / edit modal. Escape and outside clicks don't close it (as
          before) so a half-built instruction isn't lost; use Cancel / X. */}
      <Dialog open={showModal} onOpenChange={(open) => !open && closeModal()}>
        <DialogContent
          className={`${DIALOG} max-w-6xl`}
          onEscapeKeyDown={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <div className={`${DIALOG_HEAD} pr-14`}>
            <DialogTitle className="flex items-center gap-2 text-base text-primary">
              <Cpu className="h-4 w-4" />
              {editingItem
                ? "Edit Machine Instruction"
                : "Create Machine Instruction"}
              {editingItem?.rec_id != null && (
                <span className={CODE_CHIP}>#{editingItem.rec_id}</span>
              )}
            </DialogTitle>
            <DialogDescription className="mt-1 text-[12.5px]">
              Pick the machine, its total time, then add the operation steps.
            </DialogDescription>
          </div>

          <div className={DIALOG_BODY}>
            <MachineInstructionForm
              machineForm={machineForm}
              handleMachineFormChange={handleMachineFormChange}
              machineDetailInput={machineDetailInput}
              handleDetailInputChange={handleDetailInputChange}
              addMachineDetail={addMachineDetail}
              removeMachineDetail={removeMachineDetail}
              editMachineDetail={editMachineDetail} // NEW
              editingDetailIndex={editingDetailIndex} // NEW
              setEditingDetailIndex={setEditingDetailIndex} // NEW
              isEditMode={isEditMode} // NEW
              validationErrors={validationErrors}
              machineOptions={machineOptions}
              setMachineDetailInput={setMachineDetailInput}
            />
          </div>

          <div className={DIALOG_FOOT}>
            <Button variant="outline" onClick={closeModal}>
              Cancel
            </Button>
            <Button
              onClick={
                editingItem
                  ? updateMachineInstruction
                  : createMachineInstruction
              }
              disabled={isSubmitting}
            >
              {isSubmitting ? <Loader2 className="animate-spin" /> : <Save />}
              {isSubmitting
                ? "Saving..."
                : editingItem
                  ? "Update Machine Instruction"
                  : "Create Machine Instruction"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog
        open={pendingDeleteId != null}
        onOpenChange={(open) => !open && setPendingDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete machine instruction?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this machine instruction?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDeleteMachineInstruction}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default MachineTab;
