/** Geraet kann die Kamera in der App zeigen (InAppCamera.tsx). */
export function inAppCameraSupported(): boolean {
  return typeof navigator !== "undefined"
    && typeof window !== "undefined"
    && window.isSecureContext
    && !!navigator.mediaDevices?.getUserMedia;
}
