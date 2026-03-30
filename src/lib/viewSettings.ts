import { supabase } from "@/integrations/supabase/client";

export type ViewSettings = {
  internalShowPrintFiles: boolean;
  customerShowPrintFiles: boolean;
  internalShowDetailImages: boolean;
  customerShowDetailImages: boolean;
};

export const defaultViewSettings: ViewSettings = {
  internalShowPrintFiles: true,
  customerShowPrintFiles: true,
  internalShowDetailImages: true,
  customerShowDetailImages: false,
};

const boolFromValue = (value: unknown, fallback: boolean) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "ja", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "nein", "off"].includes(normalized)) return false;
  }
  return fallback;
};

export async function fetchViewSettings(): Promise<ViewSettings> {
  try {
    const { data, error } = await supabase.functions.invoke("get-view-settings", { body: {} });
    if (error || data?.error) return defaultViewSettings;
    const settings = data?.settings || {};
    return {
      internalShowPrintFiles: boolFromValue(settings.internalShowPrintFiles, defaultViewSettings.internalShowPrintFiles),
      customerShowPrintFiles: boolFromValue(settings.customerShowPrintFiles, defaultViewSettings.customerShowPrintFiles),
      internalShowDetailImages: boolFromValue(settings.internalShowDetailImages, defaultViewSettings.internalShowDetailImages),
      customerShowDetailImages: boolFromValue(settings.customerShowDetailImages, defaultViewSettings.customerShowDetailImages),
    };
  } catch {
    return defaultViewSettings;
  }
}
