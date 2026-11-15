"use client";
import React, { useState, useRef, useEffect } from "react";
import { X, ClipboardPaste, Plus, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { createPortal } from "react-dom";

/**
 * MultiValueFilter - Reusable component for filtering by multiple values
 *
 * Usage in any table:
 *   <MultiValueFilter
 *     label="Invoice No"
 *     values={activeFilters.invoice_no || []}
 *     onChange={(vals) => setActiveFilters(prev => ({ ...prev, invoice_no: vals }))}
 *   />
 *
 * To enable on any tableField in constants.js, add:
 *   { name: "invoice_no", label: "Invoice No", type: "text", multiFilter: true }
 */

export default function MultiValueFilter({ label, values = [], onChange, placeholder }) {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const inputRef = useRef(null);
  const pasteRef = useRef(null);
  const containerRef = useRef(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 300 });

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        // Also check if click is inside portal dropdown
        const portal = document.getElementById("multi-filter-portal");
        if (portal && portal.contains(e.target)) return;
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Calculate dropdown position
  const handleOpen = () => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setDropdownPos({
        top: rect.bottom + window.scrollY + 4,
        left: rect.left + window.scrollX,
        width: Math.max(rect.width, 320),
      });
    }
    setIsOpen((prev) => !prev);
  };

  // Add single value
  const addValue = (val) => {
    const trimmed = val.trim();
    if (!trimmed || values.includes(trimmed)) return;
    onChange([...values, trimmed]);
    setInputValue("");
    inputRef.current?.focus();
  };

  // Handle Enter / comma in input
  const handleInputKeyDown = (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addValue(inputValue);
    } else if (e.key === "Backspace" && inputValue === "" && values.length > 0) {
      // Remove last value on backspace when input is empty
      onChange(values.slice(0, -1));
    }
  };

  // Remove a specific value
  const removeValue = (val) => {
    onChange(values.filter((v) => v !== val));
  };

  // Clear all
  const clearAll = () => {
    onChange([]);
    setInputValue("");
    setPasteText("");
  };

  // Parse pasted text - handles Excel columns, comma-separated, newline-separated
  const parsePastedText = (text) => {
    // Split by newlines, tabs, commas, semicolons
    const raw = text
      .split(/[\n\r\t,;]+/)
      .map((v) => v.trim())
      .filter(Boolean);

    // Deduplicate and merge with existing
    const unique = [...new Set([...values, ...raw])];
    return unique;
  };

  // Apply paste
  const applyPaste = () => {
    if (!pasteText.trim()) return;
    const parsed = parsePastedText(pasteText);
    onChange(parsed);
    setPasteText("");
    setPasteMode(false);
  };

  // Handle direct paste in input (Ctrl+V with multiple values)
  const handleInputPaste = (e) => {
    const pasted = e.clipboardData.getData("text");
    // If pasted text has newlines/tabs/commas - treat as bulk
    if (/[\n\r\t,;]/.test(pasted)) {
      e.preventDefault();
      const parsed = parsePastedText(pasted);
      onChange(parsed);
    }
    // else let normal paste happen (single value)
  };

  const hasValues = values.length > 0;

  const dropdownContent = isOpen ? (
    <div
      id="multi-filter-portal"
      style={{
        position: "absolute",
        top: dropdownPos.top,
        left: dropdownPos.left,
        width: dropdownPos.width,
        zIndex: 999999,
      }}
      className="bg-white border border-gray-200 rounded-lg shadow-xl p-3 space-y-3"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-700">
          Filter by {label}
        </span>
        {hasValues && (
          <button
            onClick={clearAll}
            className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1"
          >
            <X className="h-3 w-3" /> Clear all
          </button>
        )}
      </div>

      {/* Active Values (chips) */}
      {hasValues && (
        <div className="flex flex-wrap gap-1 max-h-28 overflow-y-auto p-1 bg-gray-50 rounded border border-gray-100">
          {values.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-1 bg-blue-100 text-blue-800 text-xs px-2 py-0.5 rounded-full"
            >
              {v}
              <button
                onClick={() => removeValue(v)}
                className="hover:text-red-600 ml-0.5"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Mode Toggle */}
      <div className="flex gap-2">
        <button
          onClick={() => { setPasteMode(false); setTimeout(() => inputRef.current?.focus(), 50); }}
          className={`text-xs px-3 py-1 rounded-full border transition-colors ${
            !pasteMode
              ? "bg-blue-600 text-white border-blue-600"
              : "text-gray-600 border-gray-300 hover:bg-gray-100"
          }`}
        >
          <Plus className="h-3 w-3 inline mr-1" />
          Manual
        </button>
        <button
          onClick={() => { setPasteMode(true); setTimeout(() => pasteRef.current?.focus(), 50); }}
          className={`text-xs px-3 py-1 rounded-full border transition-colors ${
            pasteMode
              ? "bg-blue-600 text-white border-blue-600"
              : "text-gray-600 border-gray-300 hover:bg-gray-100"
          }`}
        >
          <ClipboardPaste className="h-3 w-3 inline mr-1" />
          Paste from Excel
        </button>
      </div>

      {/* Manual Input */}
      {!pasteMode && (
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleInputKeyDown}
            onPaste={handleInputPaste}
            placeholder={placeholder || `Type ${label} and press Enter`}
            className="flex-1 text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          <button
            onClick={() => addValue(inputValue)}
            disabled={!inputValue.trim()}
            className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Add
          </button>
        </div>
      )}

      {/* Paste Mode */}
      {pasteMode && (
        <div className="space-y-2">
          <textarea
            ref={pasteRef}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={`Paste ${label}s here (Excel column, comma or newline separated)\n\nExample:\nINV-001\nINV-002\nINV-003`}
            rows={5}
            className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none font-mono"
          />
          <div className="flex gap-2">
            <button
              onClick={applyPaste}
              disabled={!pasteText.trim()}
              className="flex-1 text-sm bg-blue-600 text-white px-3 py-1.5 rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-1"
            >
              <Filter className="h-3 w-3" />
              Apply ({parsePastedText(pasteText).length} values)
            </button>
            <button
              onClick={() => { setPasteText(""); setPasteMode(false); }}
              className="text-sm border border-gray-300 text-gray-600 px-3 py-1.5 rounded-md hover:bg-gray-100"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Helper text */}
      {!pasteMode && (
        <p className="text-xs text-gray-400">
          Press <kbd className="bg-gray-100 px-1 rounded">Enter</kbd> or{" "}
          <kbd className="bg-gray-100 px-1 rounded">,</kbd> to add.
          Paste Excel column directly in the input field.
        </p>
      )}
    </div>
  ) : null;

  return (
    <div ref={containerRef} className="relative inline-block">
      {/* Trigger Button */}
      <button
        type="button"
        onClick={handleOpen}
        className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border transition-colors ${
          hasValues
            ? "bg-blue-600 text-white border-blue-600 hover:bg-blue-700"
            : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
        }`}
      >
        <Filter className="h-3 w-3" />
        {label}
        {hasValues && (
          <span className="bg-white text-blue-600 text-xs font-bold px-1.5 py-0.5 rounded-full leading-none">
            {values.length}
          </span>
        )}
      </button>

      {/* Portal Dropdown */}
      {typeof window !== "undefined" &&
        isOpen &&
        createPortal(dropdownContent, document.body)}
    </div>
  );
}