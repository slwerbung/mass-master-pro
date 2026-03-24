

## Plan: Projektzuweisungen löschbar machen

### Problem

In der Zuweisungsliste (`CustomerManage.tsx` Zeile 186-192) fehlt ein Lösch-Button. Die RLS-Policy für DELETE auf `customer_project_assignments` existiert bereits — es fehlt nur die UI.

### Lösung

**`src/pages/CustomerManage.tsx`** — Zwei Änderungen:

1. **Lösch-Funktion hinzufügen**: Neue Funktion `deleteAssignment(id)` die `supabase.from("customer_project_assignments").delete().eq("id", id)` aufruft und danach `loadData()` neu lädt.

2. **Lösch-Button in der Zuweisungsliste**: Neben jeder Zuweisung (Zeile 187-192) einen `Trash2`-Icon-Button einfügen, der `deleteAssignment` aufruft.

### Betroffene Datei
- `src/pages/CustomerManage.tsx`

### Was sich nicht ändert
- Keine DB-Änderungen (DELETE-Policy existiert bereits)
- Keine Backend-Änderungen
- Keine anderen Dateien

