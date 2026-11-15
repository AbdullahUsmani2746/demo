"use client";

import { useState, useCallback, useEffect } from "react";
import DataTable from "./DataTable";
import AddModal from "./AddModal";
import EditModal from "./EditModal";
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from "axios";
import { toast } from "sonner";
import { Database, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
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

const errText = (error) =>
  error?.response?.data?.error || error?.response?.data?.message || error?.message || "Something went wrong";

// "Beneficiaries" → "Beneficiary", "Currencies" → "Currency", "Godowns" → "Godown"
const singular = (title = "") =>
  /ies$/i.test(title) ? title.slice(0, -3) + "y" : title.replace(/s$/i, "");

const EntityPageLayout = ({
  title,
  endpoint,
  fields,
  tableFields,
  allowEdit = true,
  allowAdd = true,    
  allowDelete = true,
  buttonText = null,
  listParams = null, // extra GET params for the list, e.g. { includeInactive: true }
}) => {
  const queryClient = useQueryClient();
  
  // States
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [deleting, setDeleting] = useState(null); // { id, item }
  
  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [limit, setLimit] = useState(10);
  
  // Search and sort states
  const [searchValue, setSearchValue] = useState("");
  const [sortField, setSortField] = useState("");
  const [sortOrder, setSortOrder] = useState("asc");

  // Build query params function
  const buildQueryParams = useCallback(() => {
    const params = {
      ...(listParams || {}),
      page: currentPage,
      limit: limit,
    };

    if (searchValue.trim()) {
      params.search = searchValue.trim();
    }

    if (sortField) {
      params.sortField = sortField;
      params.sortOrder = sortOrder;
    }

    return params;
  }, [currentPage, limit, searchValue, sortField, sortOrder, listParams]);

  // TanStack Query se data fetch karo
  const { 
    data: itemsData, 
    isLoading, 
    isFetching,
    isError, 
    error,
    refetch 
  } = useQuery({
    queryKey: ['entities', endpoint, currentPage, limit, searchValue, sortField, sortOrder],
    queryFn: async () => {
      const params = buildQueryParams();
      const response = await axios.get(endpoint, { params });
      return response.data;
    },
    placeholderData: (previousData) => previousData,
  });

  // Extract data
  const items = itemsData?.data || [];
  const pagination = itemsData?.pagination || null;

  // Create mutation with TanStack Query (axios)
  const createMutation = useMutation({
    mutationFn: async (formData) => {
      const response = await axios.post(endpoint, formData);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['entities', endpoint] });
      setCurrentPage(1);
    },
  });

  // Update mutation with TanStack Query (axios)
  const updateMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      const response = await axios.put(`${endpoint}/${id}`, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['entities', endpoint] });
      setEditingItem(null);
      toast.success(`${singular(title)} saved`);
    },
  });

  // Delete mutation with TanStack Query (axios)
  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const response = await axios.delete(`${endpoint}/${id}`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['entities', endpoint] });
      
      // Handle pagination adjustment
      if (items.length === 1 && currentPage > 1) {
        setCurrentPage(currentPage - 1);
      } else {
        refetch();
      }
    },
    onError: (error) => {
      toast.error(`Could not delete: ${errText(error)}`);
    },
  });

  // Handle pagination change
  const handlePaginationChange = (newPage, newLimit) => {
    setCurrentPage(newPage);
    setLimit(newLimit);
  };

  // Handle search change
  const handleSearchChange = (newSearchValue) => {
    setSearchValue(newSearchValue);
    setCurrentPage(1);
  };

  // Handle sort change
  const handleSortChange = (newSortField, newSortOrder) => {
    setSortField(newSortField);
    setSortOrder(newSortOrder);
    setCurrentPage(1);
  };

  // Errors are shown inside the panel (it catches the rejection).
  const handleAddSubmit = async (formData, { again } = {}) => {
    await createMutation.mutateAsync(formData);
    toast.success(`${singular(title)} added`);
    if (!again) setIsAddModalOpen(false);
  };

  const handleEditSubmit = async (formData) => {
    if (!editingItem) return;
    
    const id = editingItem.id || editingItem.acno || editingItem.ccno || editingItem.parameter_name;
    await updateMutation.mutateAsync({ id, data: formData });
  };

  const handleDelete = (id, item) => setDeleting({ id, item });
  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await deleteMutation.mutateAsync(deleting.id);
      toast.success(`${singular(title)} deleted`);
      setEditingItem(null);
    } catch {
      // the mutation shows the toast
    } finally {
      setDeleting(null);
    }
  };

  const handleEdit = (item) => {
    setEditingItem(item);
  };

  const loading = isLoading || (isFetching && !items.length);
  const total = pagination?.total ?? items.length;
  const editId = (item) => item?.id || item?.acno || item?.ccno || item?.parameter_name;

  // N = add, unless typing or a panel is open.
  useEffect(() => {
    const onKey = (e) => {
      if (!allowAdd || isAddModalOpen || editingItem || deleting) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        setIsAddModalOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [allowAdd, isAddModalOpen, editingItem, deleting]);

  return (
    <div className="min-h-screen bg-muted/40">
      <div className="mx-auto max-w-[1400px] px-3 py-5 sm:px-6">
        {/* Header */}
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#800000] to-[#5c0000] text-white shadow-md shadow-red-900/20">
              <Database className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[12.5px] text-muted-foreground">Accounting · Setup</p>
              <h1 className="flex flex-wrap items-center gap-2.5 text-2xl font-bold tracking-tight text-foreground">
                {title}
                <span className="inline-flex h-6 items-center rounded-full bg-primary/10 px-2.5 text-xs font-bold tabular-nums text-primary">
                  {total}
                </span>
              </h1>
            </div>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <Button variant="outline" className="h-10 gap-2 bg-background" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            {allowAdd && (
              <Button className="h-10 flex-1 gap-2 sm:flex-none" onClick={() => setIsAddModalOpen(true)}>
                <Plus className="h-4 w-4" />
                {buttonText || `Add ${singular(title)}`}
                <kbd className="hidden rounded border border-white/40 px-1 font-mono text-[10.5px] sm:inline">N</kbd>
              </Button>
            )}
          </div>
        </div>

        {isError && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
            <span className="font-medium text-destructive">Could not load the list: {errText(error)}</span>
            <Button variant="outline" size="sm" onClick={() => refetch()}>Try again</Button>
          </div>
        )}

        <DataTable
          data={items}
          fields={fields}
          tableFields={tableFields}
          onEdit={handleEdit}
          onDelete={handleDelete}
          loading={loading}
          pagination={pagination}
          onPaginationChange={handlePaginationChange}
          onSearchChange={handleSearchChange}
          onSortChange={handleSortChange}
          searchValue={searchValue}
          sortField={sortField}
          sortOrder={sortOrder}
          allowEdit={allowEdit}
          allowDelete={allowDelete}
        />
      </div>

      {isAddModalOpen && (
        <AddModal
          title={`Add ${singular(title)}`}
          fields={fields}
          onSubmit={handleAddSubmit}
          onClose={() => setIsAddModalOpen(false)}
          isSubmitting={createMutation.isPending}
        />
      )}

      {editingItem && (
        <EditModal
          title={`Edit ${singular(title)}`}
          fields={fields}
          initialData={editingItem}
          onSubmit={handleEditSubmit}
          onClose={() => setEditingItem(null)}
          onDelete={allowDelete ? () => handleDelete(editId(editingItem), editingItem) : undefined}
          isSubmitting={updateMutation.isPending}
        />
      )}

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this {singular(title).toLowerCase()}?</AlertDialogTitle>
            <AlertDialogDescription>
              It is removed for good. If it is already used somewhere the system will refuse — close or deactivate it instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default EntityPageLayout;