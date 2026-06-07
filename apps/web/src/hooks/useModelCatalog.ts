import { useEffect, useState } from "react";
import type { ModelSummary } from "@pi-gui/shared";
import { apiUrl } from "../domain/apiUrl";
import { authHeaders } from "../domain/runtimeConfig";
import { FALLBACK_MODELS } from "../domain/models";

export function useModelCatalog(): ModelSummary[] {
  const [models, setModels] = useState<ModelSummary[]>(FALLBACK_MODELS);

  useEffect(() => {
    void fetch(apiUrl("/api/models"), { headers: authHeaders() })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("读取模型失败"))))
      .then((data: { models?: ModelSummary[] }) => {
        if (data.models?.length) setModels(data.models);
      })
      .catch(() => {
        setModels(FALLBACK_MODELS);
      });
  }, []);

  return models;
}
