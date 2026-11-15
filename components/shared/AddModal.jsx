"use client";
// Add form of a setup screen — the shared side panel (EntityFormPanel.jsx).
import EntityFormPanel from "./EntityFormPanel";

const AddModal = ({ title, fields, onSubmit, onClose, isSubmitting }) => (
  <EntityFormPanel mode="add" title={title} fields={fields} onSubmit={onSubmit} onClose={onClose} isSubmitting={isSubmitting} />
);

export default AddModal;
