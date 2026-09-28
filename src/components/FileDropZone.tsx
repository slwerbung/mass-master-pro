import { useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from "react";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// Drag & drop for every upload in the app. Wrap the area that already holds
// the upload button / thumbnails; dropped files go through the same handler
// as the file picker, so validation, compression and upload stay in one
// place.
//
//   <FileDropZone accept="image/*" multiple onFiles={dropToChange(handleImageUpload)}>
//     ...existing upload UI...
//   </FileDropZone>

interface FileDropZoneProps {
  /** Same syntax as <input accept>: "image/*", ".pdf,.png", "application/pdf" … */
  accept?: string;
  /** Without it only the first matching file is passed on. */
  multiple?: boolean;
  disabled?: boolean;
  onFiles: (files: FileList) => void | Promise<void>;
  /** Text on the overlay while dragging. */
  label?: string;
  /** For zones spanning a whole page: the overlay covers the viewport. */
  fullscreen?: boolean;
  className?: string;
  children: ReactNode;
}

// Mirrors the browser's own <input accept> matching.
export function fileMatchesAccept(file: File, accept?: string): boolean {
  if (!accept || !accept.trim()) return true;
  const name = file.name.toLowerCase();
  const type = (file.type || "").toLowerCase();
  return accept.split(",").map(s => s.trim().toLowerCase()).filter(Boolean).some(rule => {
    if (rule.startsWith(".")) return name.endsWith(rule);
    if (rule.endsWith("/*")) return type.startsWith(rule.slice(0, -1));
    return type === rule;
  });
}

function toFileList(files: File[]): FileList {
  const dt = new DataTransfer();
  files.forEach(f => dt.items.add(f));
  return dt.files;
}

/**
 * Adapts an existing `onChange` handler of a file input so it can be used as
 * `onFiles`. The handler gets an event-shaped object with `target.files`
 * (and a writable `target.value`, which handlers reset after reading).
 */
export function dropToChange(handler: (e: ChangeEvent<HTMLInputElement>) => unknown) {
  return (files: FileList) => {
    handler({ target: { files, value: "" }, currentTarget: { files, value: "" } } as unknown as ChangeEvent<HTMLInputElement>);
  };
}

// Zones can be nested (e.g. a whole page accepts a new photo, a card inside
// it accepts a print file). Drag events bubble from the innermost zone
// outwards; the innermost one marks the native event so outer zones stay
// quiet and don't show a second overlay or grab the drop.
const CLAIMED = "__fileDropZoneClaimed";
const isClaimed = (e: DragEvent) => !!(e.nativeEvent as unknown as Record<string, unknown>)[CLAIMED];
const claim = (e: DragEvent) => { (e.nativeEvent as unknown as Record<string, unknown>)[CLAIMED] = true; };

export function FileDropZone({ accept, multiple, disabled, onFiles, label, fullscreen, className, children }: FileDropZoneProps) {
  const [dragging, setDragging] = useState(false);
  // True while the cursor is over a nested zone that handles the drop.
  const [innerActive, setInnerActive] = useState(false);
  // dragenter/dragleave also fire for every child element; counting them
  // keeps the overlay from flickering while the cursor moves inside.
  const depth = useRef(0);

  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types || []).includes("Files");

  const onDragEnter = (e: DragEvent) => {
    if (disabled || !hasFiles(e)) return;
    e.preventDefault();
    depth.current += 1;
    setDragging(true);
  };
  const onDragOver = (e: DragEvent) => {
    if (disabled || !hasFiles(e)) return;
    const inner = isClaimed(e);
    if (inner !== innerActive) setInnerActive(inner);
    if (inner) return;
    claim(e);
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };
  const onDragLeave = (e: DragEvent) => {
    if (disabled || !hasFiles(e)) return;
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) { setDragging(false); setInnerActive(false); }
  };
  const onDrop = (e: DragEvent) => {
    if (disabled || !hasFiles(e)) return;
    // Reset in every zone the drop bubbles through, handle it only once.
    depth.current = 0;
    setDragging(false);
    setInnerActive(false);
    if (isClaimed(e)) return;
    claim(e);
    e.preventDefault();
    const all = Array.from(e.dataTransfer.files || []);
    const matching = all.filter(f => fileMatchesAccept(f, accept));
    if (matching.length === 0) {
      toast.error("Dieser Dateityp wird hier nicht unterstützt");
      return;
    }
    if (matching.length < all.length) {
      toast.warning(`${all.length - matching.length} Datei(en) übersprungen – falscher Dateityp`);
    }
    void onFiles(toFileList(multiple ? matching : matching.slice(0, 1)));
  };

  return (
    <div
      className={cn("relative", className)}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {children}
      {dragging && !innerActive && (
        <div className={cn(
          "pointer-events-none inset-0 flex flex-col items-center justify-center gap-1 border-2 border-dashed border-primary bg-primary/10 text-primary backdrop-blur-[1px]",
          fullscreen ? "fixed z-50 m-3 rounded-xl" : "absolute z-20 rounded-lg",
        )}>
          <Upload className="h-6 w-6" />
          <span className="text-sm font-medium">{label || (multiple ? "Dateien hier ablegen" : "Datei hier ablegen")}</span>
        </div>
      )}
    </div>
  );
}
