

## 3 Fixes: Kamera-Streaming Desktop, Flächen-Platzierung, Labels parallel

### 1. Desktop-Kamera: WebRTC-Streaming wiederherstellen

**`src/pages/Camera.tsx`** — Hybride Lösung:

- **Geräteerkennung**: `const isMobile = navigator.maxTouchPoints > 0`
- **Desktop** (`!isMobile && mode !== "upload"`): WebRTC-Stream via `getUserMedia({ video: { facingMode: "environment" } })` in ein `<video>`-Element. Ein Auslöser-Button macht einen Canvas-Snapshot (`canvas.toDataURL("image/jpeg", 0.85)`), der dann als `capturedImage` gesetzt wird. Stream-Cleanup im `useEffect` return.
- **Mobile**: Bestehendes `<input capture="environment">` bleibt unverändert.
- **Upload-Modus**: Immer `<input>` ohne `capture` (wie bisher).

### 2. Flächen-Platzierung: Offset-Bug fixen

**`src/lib/areaMeasurement.ts`** — Gruppe ohne `left/top` im Konstruktor erstellen, Position danach setzen:

```typescript
const group = new Group([rect, widthLabel, heightLabel, indexLabel], {
  originX: "center",
  originY: "center",
  selectable: true,
  subTargetCheck: false,
  objectCaching: true,
});
group.set({ left: left + cx, top: top + cy });
group.setCoords();
```

### 3. Labels parallel zu den Kanten, nie über die Fläche hinaus

**`src/lib/areaMeasurement.ts`** — Beide Labels parallel zu ihrer jeweiligen gestrichelten Kante:

- **Breitenlabel** (horizontal, parallel zur oberen Kante): Bleibt `angle: 0`. Schriftgröße begrenzen, sodass Textbreite ≤ `w - 2*padding`. Formel: `fontSize = Math.min(calculatedSize, w * 0.8 / textLength)` als Sicherheitsgrenze.
- **Höhenlabel** (vertikal, parallel zur linken Kante): `angle: -90`, `originX: "center"`, `originY: "center"`. Schriftgröße begrenzen, sodass Textbreite (nach Rotation = Texthöhe auf dem Canvas) ≤ `h - 2*padding`. Gleiche Begrenzungslogik.
- Position innerhalb der Fläche: Breitenlabel leicht unter der oberen Kante, Höhenlabel leicht rechts der linken Kante — beides mit Inset.

### Betroffene Dateien

| Datei | Änderung |
|---|---|
| `src/pages/Camera.tsx` | WebRTC-Streaming für Desktop, Input für Mobile |
| `src/lib/areaMeasurement.ts` | Gruppen-Position nach Konstruktor setzen; Labels parallel mit Größenbegrenzung |

