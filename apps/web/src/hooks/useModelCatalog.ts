import { useEffect, useState } from "react";
import type { ModelSummary } from "@pi-gui/shared";
import { apiUrl } from "../domain/apiUrl";
import { authHeaders } from "../domain/runtimeConfig";
import { FALLBACK_MODELS } from "../domain/models";

export function useModelCatalog(): ModelSummary[] {
  const [models, setModels] = useState<ModelSummary[]>(FALLBACK_MODELS);

  useEffect(() => {
    let active = true;
    const controller = typeof AbortController === "undefined" ? undefined : new AbortController();

    void fetch(apiUrl("/api/models"), { headers: authHeaders(), signal: controller?.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("读取模型失败"))))
      .then((data: { models?: ModelSummary[] }) => {
        if (active && data.models?.length) setModels(data.models);
      })
      .catch(() => {
        if (active) setModels(FALLBACK_MODELS);
      });

    return () => {
      active = false;
      controller?.abort();
    };
  }, []);

  return models;
}
