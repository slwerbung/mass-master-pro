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
 */
import { useRef } from "react";
import { readImageFileForEditor } from "./imageFile";

interface Options {
  /** Called with base64 imageData after the user picks/shoots an image */
  onCapture: (imageData: string) => void;
  /** If true, shows gallery picker instead of camera (no capture attribute) */
  uploadMode?: boolean;
}

export function useDirectCamera({ onCapture, uploadMode = false }: Options) {
  const inputRef = useRef<HTMLInputElement>(null);
  const processingRef = useRef(false);

  const triggerCamera = () => {
    if (inputRef.current) {
      inputRef.current.value = ""; // reset so same file can be re-selected
      inputRef.current.click();    // must be called from a user-gesture handler
    }
  };

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (processingRef.current) return;
    const file = e.target.files?.[0];
    if (!file) return;
    processingRef.current = true;
    try {
      const imageData = await readImageFileForEditor(file);
      onCapture(imageData);
    } catch {
      // ignore
    } finally {
      processingRef.current = false;
    }
  };

  const cameraInput = (
    <input
      ref={inputRef}
      type="file"
      accept="image/*"
      {...(!uploadMode ? { capture: "environment" as const } : {})}
      onChange={handleChange}
      className="hidden"
    />
  );

  return { cameraInput, triggerCamera };
}
