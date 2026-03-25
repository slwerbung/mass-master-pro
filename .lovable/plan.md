

## Fix: `get_project_prefix` gibt immer "WER-" zurück

### Problem
In `supabase/functions/admin-manage/index.ts` Zeile 239 steht `data?.value || "WER-"`. Da `""` falsy ist, wird ein leerer Präfix ignoriert und immer "WER-" zurückgegeben.

### Änderung

**`supabase/functions/admin-manage/index.ts`** — eine Zeile:
- `data?.value || "WER-"` → `data?.value ?? "WER-"`

Danach Edge Function neu deployen.

