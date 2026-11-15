  "use client";
  import { useState, useRef, useEffect } from "react";
  import SelectOriginalModal from "./SelectOriginalModal"; // Add this import
  import { motion, AnimatePresence } from "framer-motion";
  import Form from "./Form";
  import { PlusIcon, X } from "lucide-react";
  import { Button } from "@/components/ui/button";
  import useKeyboardShortcuts from "@/hooks/useKeyboardShortcuts";
  import { KeyCombo } from "@/components/ui/KeyboardHint";
  import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
  } from "@/components/ui/dialog";
import { VOUCHER_CONFIG } from "./constants";

  export default function VoucherModal({ type, category, mode, editModes = false, onCloseEdit, existingData={}, onSuccess, initialOriginalData = null }) {
    
    
    const [open, setOpen] = useState(!!initialOriginalData);
    const [modes, setModes] = useState(initialOriginalData ? "create" : mode);
    const [editMode, setEditMode] = useState(editModes);
    const [selectOriginalOpen, setSelectOriginalOpen] = useState(false);
    const [Omodal, setOmodal] = useState(false)
  const [originalData, setOriginalData] = useState(initialOriginalData);
    const overlayRef = useRef(null);

  // Single useEffect to handle editModes changes
    useEffect(() => {
      setEditMode(editModes && mode !== "clone");
      setOpen(editModes);
      
    }, [editModes, mode]);

    useEffect(() => {
      // Only show select original modal when:
  // 1. Not in edit mode
  // 2. Is a return type
  // 3. No existingData (creating new)
    if (!editMode && VOUCHER_CONFIG[type]?.sourceTranCode && Omodal) {
      setSelectOriginalOpen(true);
    }
  }, [editMode, type, Omodal]);

  const handleOriginalSelect = (selectedTxn) => {
    setOriginalData(selectedTxn);
    setOmodal(false)
    setSelectOriginalOpen(false);
  };

  // Handle click outside to close
    const handleOverlayClick = (e) => {
      if (e.target === overlayRef.current) {
        handleClose();
      }
    };

    // Handle modal close
    const handleClose = () => {
      setOpen(false);
      setEditMode(false);
      onCloseEdit?.();
    };

    // Handle opening the modal for creating a new voucher
    const handleOpen = () => {
      // Always clear originalData so SelectOriginalModal shows on each new voucher
      setOriginalData(null);
      setOmodal(!!VOUCHER_CONFIG[type]?.sourceTranCode);
      setOpen(true);
      setModes("create");
      setEditMode(false);
    };

  // Alt+N opens a new voucher. Only the instance that actually renders the
  // "New" button claims it — Table.jsx mounts further VoucherModals for edit
  // and return, and those are driven by props, not by this button.
  const ownsNewShortcut = !!VOUCHER_CONFIG[type]?.buttonText && !editModes;

  useKeyboardShortcuts(
    { "alt+n": { handler: handleOpen, allowInInput: true } },
    ownsNewShortcut && !open && !selectOriginalOpen,
  );

  // ?approvalRequest=<id>: "Edit" on a held request (Approvals → My requests)
  // put its form state into this form's draft — open the form so it loads.
  useEffect(() => {
    if (!ownsNewShortcut || typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("approvalRequest")) handleOpen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
      <>
        { VOUCHER_CONFIG[type].buttonText && (
          <Button
            onClick={handleOpen}
            title={`${VOUCHER_CONFIG[type].buttonText} (Alt+N)`}
            className="bg-primary hover:bg-primary/90 text-white flex items-center gap-2 font-medium"
          >
            <PlusIcon className="h-4 w-4" />
            {VOUCHER_CONFIG[type].buttonText}
            <span className="hidden lg:inline-flex ml-1 opacity-80">
              <KeyCombo combo="Alt+N" />
            </span>
          </Button>
        )}

        <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          ref={overlayRef}
          onClick={handleOverlayClick}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="relative w-full max-w-[99%] bg-white rounded-lg shadow-xl overflow-hidden flex flex-col max-h-[99%]"
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {/* Header */}
            <div className="flex justify-between items-center border-b p-4">
              <h2 className="text-xl font-bold">
                {editMode
                  ? VOUCHER_CONFIG[type].ModalHeadingEdit : VOUCHER_CONFIG[type].ModalHeading
                }
              </h2>
              <button
                onClick={handleClose}
                className="text-gray-500 hover:text-gray-700 text-xl font-semibold"
              >
                ×
              </button>
            </div>

            <div className="flex-1 overflow-auto p-2">
              <Form
                type={type}
                editMode={editMode}
                mode={modes === "clone" ? "create" : modes}
                onClose={handleClose}
                existingData={editMode || modes === "clone" ? existingData : null}
                onSuccess={onSuccess}
                originalData={originalData}
                isClone={modes === "clone"}
              />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
         {/* Add this modal for selecting original transaction */}
      <SelectOriginalModal
        type={type}
        isOpen={selectOriginalOpen}
        onClose={() => {
          setSelectOriginalOpen(false);
          handleClose();
        }}
        onSelect={handleOriginalSelect}
        sourceTranCode={VOUCHER_CONFIG[type]?.sourceTranCode}
        sourceLabel={VOUCHER_CONFIG[type]?.sourceLabel}
      />
      </>
    );
  }

