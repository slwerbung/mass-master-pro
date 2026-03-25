

## Fix: Kamera reagiert nicht auf Orientierungswechsel

### Ursache

Das Problem ist, dass der Kamera-Stream nur einmal beim Mount gestartet wird (`useEffect([], [])`). Wenn das Smartphone gedreht wird, bleibt der bestehende Video-Stream in seiner ursprünglichen Auflösung/Orientierung — das `<video>`-Element passt sich zwar in der Größe an, aber der Stream selbst liefert weiterhin das alte Seitenverhältnis.

### Lösung

**`src/pages/Camera.tsx`** — 2 Änderungen:

1. **Orientierungswechsel erkennen und Stream neu starten**: Einen `orientationchange`-Listener (+ `resize` als Fallback) hinzufügen, der den aktuellen Stream stoppt und `startCamera()` erneut aufruft. Damit fordert der Browser einen neuen Stream mit der korrekten Orientierung an.

2. **Stream-Referenz per `useRef` statt `useState`**: Der `stopCamera()` in der Cleanup-Funktion hat eine stale Closure auf `stream`. Umstellung auf `useRef` stellt sicher, dass der aktuelle Stream zuverlässig gestoppt wird — auch bei schnellen Orientierungswechseln.

```typescript
// Orientierungswechsel-Handler
useEffect(() => {
  const handleOrientationChange = () => {
    if (!capturedImage) {
      stopCamera();
      setTimeout(() => startCamera(), 300);
    }
  };
  
  screen.orientation?.addEventListener("change", handleOrientationChange);
  window.addEventListener("orientationchange", handleOrientationChange);
  
  return () => {
    screen.orientation?.removeEventListener("change", handleOrientationChange);
    window.removeEventListener("orientationchange", handleOrientationChange);
  };
}, [capturedImage]);
```

Das `setTimeout(300ms)` gibt dem Browser Zeit, die neue Viewport-Geometrie zu berechnen, bevor ein neuer Stream angefordert wird.

### Betroffene Datei

| Datei | Änderung |
|---|---|
| `src/pages/Camera.tsx` | Stream-Ref + Orientierungs-Listener |

