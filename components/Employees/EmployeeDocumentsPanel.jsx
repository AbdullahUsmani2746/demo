"use client";

import { useState } from "react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { FileText, Image as ImageIcon, Upload, X, Loader2, ExternalLink } from "lucide-react";

const DOC_TYPES = [
  { type: "PHOTOGRAPH", label: "Photograph", multiple: false, icon: ImageIcon, accept: "image/*" },
  { type: "CNIC", label: "CNIC Document", multiple: false, icon: FileText, accept: "image/*,.pdf" },
  { type: "EDUCATION_CERTIFICATE", label: "Educational Certificates", multiple: true, icon: FileText, accept: "image/*,.pdf" },
  { type: "EXPERIENCE_CERTIFICATE", label: "Experience Certificates", multiple: true, icon: FileText, accept: "image/*,.pdf" },
];

const FIELD_BY_TYPE = {
  PHOTOGRAPH: "photographUrl",
  CNIC: "cnicDocumentUrl",
  EDUCATION_CERTIFICATE: "educationalCertificates",
  EXPERIENCE_CERTIFICATE: "experienceCertificates",
};

function fileNameFromUrl(url) {
  try {
    return decodeURIComponent(url.split("/").pop());
  } catch {
    return url;
  }
}

// employeeId: required — documents can only be uploaded for an employee that
// already exists, so the parent should not render this until saved once.
// documents: { photographUrl, cnicDocumentUrl, educationalCertificates, experienceCertificates }
// onChange: (nextDocuments) => void — called after every successful upload/remove
export default function EmployeeDocumentsPanel({ employeeId, documents, onChange }) {
  const [busyType, setBusyType] = useState(null);
  const [error, setError] = useState(null);

  const handleUpload = async (docType, fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;

    setBusyType(docType);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("employeeId", employeeId);
      formData.append("docType", docType);
      files.forEach((f) => formData.append("file", f));

      const res = await axios.post("/api/employees/documents", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      onChange(res.data.employee);
    } catch (err) {
      setError(err?.response?.data?.error || "Upload failed");
    } finally {
      setBusyType(null);
    }
  };

  const handleRemove = async (docType, url) => {
    setBusyType(docType);
    setError(null);
    try {
      const params = { employeeId, docType };
      if (url) params.url = url;
      const res = await axios.delete("/api/employees/documents", { params });
      onChange(res.data.employee);
    } catch (err) {
      setError(err?.response?.data?.error || "Remove failed");
    } finally {
      setBusyType(null);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {error && <p className="text-sm font-medium text-destructive md:col-span-2">{error}</p>}
      {DOC_TYPES.map(({ type, label, multiple, icon: Icon, accept }) => {
        const field = FIELD_BY_TYPE[type];
        const value = documents?.[field];
        const urls = multiple ? value || [] : value ? [value] : [];
        const busy = busyType === type;

        return (
          <div key={type} className="space-y-3 rounded-xl border bg-card p-4">
            <Label className="flex items-center gap-1.5 text-sm font-bold">
              <Icon className="h-4 w-4" />
              {label}
            </Label>

            {urls.length > 0 && (
              <ul className="space-y-1">
                {urls.map((url) => (
                  <li key={url} className="flex items-center justify-between rounded-md border px-3 py-1.5 text-sm">
                    <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-primary truncate">
                      <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{fileNameFromUrl(url)}</span>
                    </a>
                    <button
                      type="button"
                      className="text-destructive shrink-0 ml-2"
                      onClick={() => handleRemove(type, multiple ? url : undefined)}
                      disabled={busy}
                      aria-label={`Remove ${fileNameFromUrl(url)}`}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {(multiple || urls.length === 0) && (
              <label className="flex items-center gap-2 w-fit cursor-pointer text-sm font-semibold border border-dashed rounded-md px-3 py-2 hover:bg-accent">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {busy ? "Uploading..." : multiple ? "Add file(s)" : "Upload"}
                <input
                  type="file"
                  accept={accept}
                  multiple={multiple}
                  className="hidden"
                  disabled={busy}
                  onChange={(e) => {
                    handleUpload(type, e.target.files);
                    // allow picking the same file again after a failure/removal
                    e.target.value = "";
                  }}
                />
              </label>
            )}
          </div>
        );
      })}
    </div>
  );
}
