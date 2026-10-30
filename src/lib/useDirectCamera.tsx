/**
 * useDirectCamera
 *
 * iOS Safari blocks programmatic file-input clicks that originate from
 * setTimeout or useEffect (no user-gesture in the call stack). This hook
 * provides a .trigger() that MUST be called directly from an onClick handler.
 * The hidden <input> is rendered via the returned `cameraInput` element.
 *
 * Usage:
 *   const { cameraInput, triggerCamera } = useDirectCamera({ onCapture });
 *   return <>
 *     {cameraInput}
 *     <Button onClick={triggerCamera}>Kamera</Button>
 *   </>;
 *
 * `handleFileChange` is the same handler, exposed so a FileDropZone can feed
 * dropped files through it (`onFiles={dropToChange(handleFileChange)}`).
 */
import { useRef, useState } from "react";
import { readImageFileForEditor } from "./imageFile";
import { startCapture } from "./captureSession";
import { markCameraOpening } from "@/lib/cameraGuard";
import { InAppCamera } from "@/components/InAppCamera";
import { inAppCameraSupported } from "@/lib/inAppCamera";

interface Options {
  /** Called with base64 imageData after the user picks/shoots an image */
  onCapture: (imageData: string) => void;
  /** If true, shows gallery picker instead of camera (no capture attribute) */
  uploadMode?: boolean;
  /**
   * Editor route the photo is headed for. When set, the photo is stored in
   * the durable capture session BEFORE it is decoded, so a restart while
   * handling it can resume there (see captureSession.ts).
   */
  editorPath?: () => string;
}

export function useDirectCamera({ onCapture, uploadMode = false, editorPath }: Options) {
  const inputRef = useRef<HTMLInputElement>(null);
  const processingRef = useRef(false);
  const [inAppOpen, setInAppOpen] = useState(false);

  const openSystemPicker = () => {
    if (inputRef.current) {
      inputRef.current.value = ""; // reset so same file can be re-selected
      inputRef.current.click();    // must be called from a user-gesture handler
    }
  };

  // Camera: inside the app whenever possible – the system camera app sends
  // us to the background, where Android ends the app (see InAppCamera.tsx).
  const triggerCamera = () => {
    if (!uploadMode && inAppCameraSupported()) setInAppOpen(true);
    else openSystemPicker();
  };

  const processFile = async (file: File) => {
    if (processingRef.current) return;
    processingRef.current = true;
    try {
      if (editorPath) await startCapture(file, editorPath());
      const imageData = await readImageFileForEditor(file);
      onCapture(imageData);
    } catch {
      // ignore
    } finally {
      processingRef.current = false;
    }
  };

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processFile(file);
  };

  const cameraInput = (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        {...(!uploadMode ? { capture: "environment" as const } : {})}
        onClick={() => markCameraOpening("editor")}
        onChange={handleChange}
        className="hidden"
      />
      {!uploadMode && (
        <InAppCamera
          open={inAppOpen}
          onClose={() => setInAppOpen(false)}
          onUseSystemCamera={() => { setInAppOpen(false); openSystemPicker(); }}
          onCapture={(file) => { setInAppOpen(false); void processFile(file); }}
        />
      )}
    </>
  );

  return { cameraInput, triggerCamera, handleFileChange: handleChange };
}
