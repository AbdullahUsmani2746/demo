"use client";

import { useParams } from "next/navigation";
import { useMemo } from "react";
import EntityPageLayout from "@/components/shared/EntityPageLayout";
import entityConfig from "@/components/Setups/config";
import { useQuery } from '@tanstack/react-query';
import axios from "axios";

const DynamicEntity = () => {
  const { entity } = useParams();
  const config = entityConfig[entity];

  // TanStack Query se sab related data fetch karo
  const selectFields = useMemo(() => {
    if (!config?.fields) return [];
    return config.fields.filter((field) => field.fieldType === "select" && field.fetchFrom);
  }, [config]);

  // Ek query mein sab related data fetch karo
  const { data: relatedData, isLoading } = useQuery({
    queryKey: ['relatedData', entity],
    queryFn: async () => {
      const results = {};
      const promises = selectFields.map(async (field) => {
        try {
          const response = await axios.get(field.fetchFrom);
          results[field.name] = response.data.data || response.data;
        } catch (err) {
          console.error(`Error fetching ${field.name}:`, err);
          results[field.name] = [];
        }
      });
      await Promise.all(promises);
      return results;
    },
    enabled: selectFields.length > 0,
  });

  // Fields ko options ke saath combine karo
  const fieldsWithOptions = useMemo(() => {
    if (!config?.fields) return [];

    return config.fields.map((field) => {
      if (
        field.fieldType === "select" &&
        relatedData?.[field.name] &&
        field.optionLabelKey &&
        field.optionValueKey
      ) {
        return {
          ...field,
          options: relatedData[field.name]?.map((item) => ({
            label: typeof field.optionLabelKey === "function"
              ? field.optionLabelKey(item)
              : item[field.optionLabelKey],
            value: item[field.optionValueKey],
          })),
        };
      }
      return field;
    });
  }, [config, relatedData]);

  if (!config) {
    return <div className="p-4 text-red-500">Invalid entity: {entity}</div>;
  }

  return (
    <EntityPageLayout
      title={config.title}
      endpoint={config.endpoint}
      listParams={config.listParams}
      fields={fieldsWithOptions}
      tableFields={config.tableFields || fieldsWithOptions}
      buttonText={config.buttonText}
      allowAdd={config.allowAdd}
      allowEdit={config.allowEdit}
      allowDelete={config.allowDelete}
    />
  );
};

export default DynamicEntity;