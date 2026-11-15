"use client";
import React, { useState, useEffect } from "react";
import { useCompany } from "@/context/CompanyContext";
import { Building, Check, Save, RefreshCw, Upload, Image, Info, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const LABEL = "mb-1 block text-[12.5px] font-semibold text-foreground/80";

const CompanySettings = () => {
  const { company, loading, updateCompany } = useCompany();
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [formData, setFormData] = useState({
    id: "",
    company: "",
    logo: "",
    addr1: "",
    addr2: "",
    city: "",
    phone: "",
    fax: "",
    email: "",
  });

  // Initialize form data when company data is loaded
  useEffect(() => {
    if (company) {
      setFormData({
        id: company.id || "",
        company: company.name || "",
        logo: company.logo || "",
        addr1: company.addr1 || "",
        addr2: company.addr2 || "",
        city: company.city || "",
        phone: company.phone || "",
        fax: company.fax || "",
        email: company.email || "",
      });
    }
  }, [company]);

  // An empty field ("") and an unset one (null) are the same — otherwise any
  // blank company field kept Save / Reset showing for good.
  const differs = (a, b) => (a ?? "") !== (b ?? "");
  const hasChanges =
    differs(formData.company, company?.name) ||
    differs(formData.logo, company?.logo) ||
    differs(formData.addr1, company?.addr1) ||
    differs(formData.addr2, company?.addr2) ||
    differs(formData.city, company?.city) ||
    differs(formData.phone, company?.phone) ||
    differs(formData.fax, company?.fax) ||
    differs(formData.email, company?.email);

  const handleChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveSuccess(false);

    const result = await updateCompany({
      ...formData,
      id: company.id,
      company: formData.company, // Ensure correct field name
    });

    if (result.success) {
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    }

    setSaving(false);
  };

  const handleReset = () => {
    setFormData({
      id: company.id || "",
      company: company.name || "",
      logo: company.logo || "",
      addr1: company.addr1 || "",
      addr2: company.addr2 || "",
      city: company.city || "",
      phone: company.phone || "",
      fax: company.fax || "",
      email: company.email || "",
    });
  };

  if (loading && !company) {
    return (
      <div className="flex min-h-[240px] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading company settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#800000] to-[#5c0000] text-white shadow-md shadow-red-900/20">
            <Building className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">Company</h2>
            <p className="text-xs text-muted-foreground">Name, logo and address printed on PDFs and reports</p>
          </div>
        </div>
        {hasChanges && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={handleReset}
              disabled={saving}
              className="h-10 gap-2 bg-background"
            >
              <RefreshCw className="h-4 w-4" />
              Reset
            </Button>
            <Button onClick={handleSave} disabled={saving} className="h-10 gap-2">
              {saving ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  Save Changes
                </>
              )}
            </Button>
          </div>
        )}
      </div>

      {/* Current company */}
      <div className="flex items-center gap-4 rounded-xl border border-border bg-background p-4">
        <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-background">
          {formData.logo ? (
            <img
              src={formData.logo}
              alt="Company Logo"
              className="h-full w-full object-contain"
            />
          ) : (
            <Building className="h-7 w-7 text-primary/60" />
          )}
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wider text-primary">Current company</p>
          <h3 className="truncate text-lg font-bold text-foreground">{company?.name || "Company Name"}</h3>
          <p className="text-sm text-muted-foreground">{company?.city || "City"}</p>
        </div>
      </div>

      {/* Success message */}
      {saveSuccess && (
        <div className="flex items-center gap-3 rounded-lg bg-[#edf2ee] px-4 py-3 text-[#2f5139] animate-in fade-in slide-in-from-top-2">
          <Check className="h-5 w-5 flex-shrink-0" />
          <p className="text-sm font-medium">Company settings updated successfully!</p>
        </div>
      )}

      {/* Company form */}
      <div className="overflow-hidden rounded-xl border border-border bg-background">
        <div className="border-b border-primary/15 bg-primary/5 px-4 py-3">
          <h3 className="text-[15px] font-semibold text-primary">Company information</h3>
          <p className="text-xs text-muted-foreground">Fields marked * are required</p>
        </div>

        <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
          {/* Company Name */}
          <div className="sm:col-span-2">
            <label htmlFor="company" className={LABEL}>
              Company Name<span className="text-primary"> *</span>
            </label>
            <Input
              id="company"
              value={formData.company}
              onChange={(e) => handleChange("company", e.target.value)}
              placeholder="Enter company name"
              className="h-10"
            />
          </div>

          {/* Logo URL */}
          <div className="sm:col-span-2">
            <label htmlFor="logo" className={LABEL}>Logo URL</label>
            <div className="flex items-center gap-2">
              <Input
                id="logo"
                value={formData.logo}
                onChange={(e) => handleChange("logo", e.target.value)}
                placeholder="/logo.png or https://..."
                className="h-10"
              />
              <Button
                variant="outline"
                size="icon"
                disabled
                aria-label="Upload logo (not available)"
                className="h-10 w-10 flex-shrink-0 bg-background"
              >
                <Upload className="h-4 w-4" />
              </Button>
            </div>
            {formData.logo && (
              <div className="mt-2 flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-2">
                <Image className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Preview:</span>
                <img
                  src={formData.logo}
                  alt="Logo Preview"
                  className="h-8 object-contain"
                  onError={(e) => {
                    e.target.style.display = "none";
                  }}
                />
              </div>
            )}
          </div>

          {/* Address Line 1 */}
          <div>
            <label htmlFor="addr1" className={LABEL}>Address Line 1</label>
            <Input
              id="addr1"
              value={formData.addr1}
              onChange={(e) => handleChange("addr1", e.target.value)}
              placeholder="Street address"
              className="h-10"
            />
          </div>

          {/* Address Line 2 */}
          <div>
            <label htmlFor="addr2" className={LABEL}>Address Line 2</label>
            <Input
              id="addr2"
              value={formData.addr2}
              onChange={(e) => handleChange("addr2", e.target.value)}
              placeholder="Additional address info"
              className="h-10"
            />
          </div>

          {/* City */}
          <div>
            <label htmlFor="city" className={LABEL}>City</label>
            <Input
              id="city"
              value={formData.city}
              onChange={(e) => handleChange("city", e.target.value)}
              placeholder="City name"
              className="h-10"
            />
          </div>

          {/* Phone */}
          <div>
            <label htmlFor="phone" className={LABEL}>Phone</label>
            <Input
              id="phone"
              value={formData.phone}
              onChange={(e) => handleChange("phone", e.target.value)}
              placeholder="+92 21 1234567"
              className="h-10"
            />
          </div>

          {/* Fax */}
          <div>
            <label htmlFor="fax" className={LABEL}>Fax</label>
            <Input
              id="fax"
              value={formData.fax}
              onChange={(e) => handleChange("fax", e.target.value)}
              placeholder="Fax number"
              className="h-10"
            />
          </div>

          {/* Email */}
          <div>
            <label htmlFor="email" className={LABEL}>Email</label>
            <Input
              id="email"
              type="email"
              value={formData.email}
              onChange={(e) => handleChange("email", e.target.value)}
              placeholder="company@example.com"
              className="h-10"
            />
          </div>
        </div>
      </div>

      {/* Info box */}
      <div className="rounded-xl border border-border bg-muted/40 p-4">
        <h3 className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-primary">
          <Info className="h-4 w-4" />
          Good to know
        </h3>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Company name and logo will appear on all PDFs and reports</li>
          <li>Logo should be a public URL or path (e.g., /logo.png)</li>
          <li>Address will be displayed in PDF headers</li>
          <li>Changes apply globally across the application</li>
        </ul>
      </div>
    </div>
  );
};

export default CompanySettings;
