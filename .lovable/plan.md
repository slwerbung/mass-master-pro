

## Problem

Die `customers`-Tabelle hat Row-Level Security (RLS) aktiviert, aber es existiert keine SELECT-Policy. Der Frontend-Client nutzt den `anon`-Key und bekommt daher keine Kundendaten zurück. Der Kunden-Login schlägt immer fehl mit "Name nicht gefunden".

Dasselbe Problem, das zuvor bei der `employees`-Tabelle bestand und durch eine SELECT-Policy behoben wurde.

## Lösung

Eine SELECT-Policy auf der `customers`-Tabelle anlegen, die dem `anon`-Rolle Lesezugriff gibt:

```sql
CREATE POLICY "Anon can read customers"
  ON public.customers
  FOR SELECT
  TO anon
  USING (true);
```

## Betroffene Dateien

- Neue Datenbank-Migration (nur die eine Policy)

## Was sich nicht ändert

- Kein App-Code
- Keine UI-Änderungen
- Keine Backend-/Edge-Function-Änderungen

