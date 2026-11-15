"use client";
// Edit form of a setup screen — the shared side panel (EntityFormPanel.jsx).
import EntityFormPanel from "./EntityFormPanel";

const EditModal = ({ title, fields, initialData, onSubmit, onClose, onDelete, isSubmitting }) => (
  <EntityFormPanel
    mode="edit"
    title={title}
    fields={fields}
    initialData={initialData}
    onSubmit={onSubmit}
    onClose={onClose}
    onDelete={onDelete}
    isSubmitting={isSubmitting}
  />
);

export default EditModal;
