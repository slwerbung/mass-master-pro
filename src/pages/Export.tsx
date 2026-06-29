import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, FileImage, FileText, Download, Archive, Loader2, Send } from "lucide-react";
import { indexedDBStorage } from "@/lib/indexedDBStorage";
import { Project } from "@/types/project";
import { toast } from "sonner";
import jsPDF from "jspdf";
import JSZip from "jszip";
import { enqueueHeroUploadIfLinked, getHeroProjectMatchId } from "@/lib/heroSyncHelpers";
import { supabase } from "@/integrations/supabase/client";
import {
  downloadImage,
  downloadBlob,
  dataURItoBlob,
  isIOSDevice,
} from "@/lib/exportUtils";
import PDFExportOptionsUI, { PDFExportOptions, defaultPDFOptions } from "@/components/PDFExportOptions";
import {
  drawCoverPage,
  drawLocationPage,
  drawMediaPage,
  drawFloorPlanPage,
  drawDetailPage,
  type FieldRow,
  type PillKind,
} from "@/lib/pdfHelpers";
import * as pdfjsLib from "pdfjs-dist";
import { mergeWithDefaultLocationFields } from "@/lib/customerFields";
import { hydrateProjectFromSupabase } from "@/lib/supabaseSync";
import { fetchViewSettings, defaultViewSettings } from "@/lib/viewSettings";

// Reuse the worker source proven in LocationApprovalMedia / FloorPlanUpload.
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

// Public URL for a stored print file (the project-files bucket is public).
const publicFileUrl = (path: string) => supabase.storage.from("project-files").getPublicUrl(path).data.publicUrl;

async function urlToDataUrl(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url);
    const blob = await resp.blob();
    return await new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as string);
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

// Rasterise a production PDF to one JPEG data-URL per page (same approach the
// app's LocationApprovalMedia uses to show production files as the main image).
async function rasterizePdf(url: string, name: string): Promise<{ src: string; label: string }[]> {
  const resp = await fetch(url);
  const buf = await resp.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  const out: { src: string; label: string }[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(2.2, 1600 / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale: scale > 0 ? scale : 1 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d")!;
    await page.render({ canvasContext: ctx, viewport }).promise;
    out.push({ src: canvas.toDataURL("image/jpeg", 0.82), label: doc.numPages > 1 ? `${name} · S.${i}` : name });
  }
  return out;
}

type FieldConfig = {
  id?: string;
  field_key: string;
  field_label: string;
  field_type: "text" | "textarea" | "dropdown" | "checkbox";
  is_active: boolean;
  customer_visible: boolean;
  sort_order: number;
};

type FeedbackItem = {
  id: string;
  location_id: string;
  message: string;
  author_name: string;
  author_type?: string;
  status: "open" | "done";
  created_at: string;
};

const Export = () => {
  const { projectId } = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [fieldConfigs, setFieldConfigs] = useState<FieldConfig[]>([]);
  const [projectFieldConfigs, setProjectFieldConfigs] = useState<any[]>([]);
  const [feedbackMap, setFeedbackMap] = useState<Record<string, FeedbackItem[]>>({});
  const [approvedLocationIds, setApprovedLocationIds] = useState<Set<string>>(new Set());
  const [printFilesByLocation, setPrintFilesByLocation] = useState<Record<string, any[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [downloadingPDF, setDownloadingPDF] = useState(false);
  const [sendingToHero, setSendingToHero] = useState(false);
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [downloadingImages, setDownloadingImages] = useState<Record<string, boolean>>({});
  const [pdfOptions, setPdfOptions] = useState<PDFExportOptions>(defaultPDFOptions);
  const [viewSettings, setViewSettings] = useState(defaultViewSettings);
  const [companyLogo, setCompanyLogo] = useState<string | null>(null);
  const [employeeName, setEmployeeName] = useState<string>("");
  const navigate = useNavigate();

  useEffect(() => {
    const loadProject = async () => {
      if (!projectId) return;
      try {
        const [fieldsRes, projectFieldsRes, feedbackRes, loadedViewSettings] = await Promise.all([
          supabase
            .from("location_field_config")
            .select("id, field_key, field_label, field_type, is_active, customer_visible, sort_order")
            .order("sort_order"),
          supabase.from("project_field_config").select("*").eq("is_active", true).order("sort_order"),
          supabase
            .from("location_feedback")
            .select("id, location_id, message, author_name, author_type, status, created_at")
            .order("created_at", { ascending: true }),
          fetchViewSettings(),
        ]);

        // Prefer IndexedDB (has full images as blobs) for PDF export.
        // Supabase hydration as fallback for online-only projects.
        let loadedProject = await indexedDBStorage.getProject(projectId);
        if (!loadedProject) {
          loadedProject = await hydrateProjectFromSupabase(projectId);
        }

        if (!loadedProject) {
          toast.error("Projekt nicht gefunden");
          navigate("/");
          return;
        }

        setProject(loadedProject);
        setViewSettings(loadedViewSettings);
        setFieldConfigs((fieldsRes.data || []) as FieldConfig[]);
        setProjectFieldConfigs((projectFieldsRes.data || []) as any[]);

        // Load company logo
        supabase.functions.invoke("admin-manage", { body: { action: "get_logo" } })
          .then(({ data }) => { if (data?.logo) setCompanyLogo(data.logo); });

        // Load employee name for "Zeichner"
        const empId = loadedProject.employeeId;
        if (empId) {
          supabase.functions.invoke("admin-manage", { body: { action: "get_employee_name", employeeId: empId } })
            .then(({ data }) => { if (data?.name) setEmployeeName(data.name); });
        }

        const nextFeedbackMap: Record<string, FeedbackItem[]> = {};
        (feedbackRes.data || []).forEach((entry: any) => {
          if (!nextFeedbackMap[entry.location_id]) nextFeedbackMap[entry.location_id] = [];
          nextFeedbackMap[entry.location_id].push(entry as FeedbackItem);
        });
        setFeedbackMap(nextFeedbackMap);

        const locationIds = loadedProject.locations.map((loc) => loc.id);
        if (locationIds.length > 0) {
          const [{ data: printFiles }, { data: approvals }] = await Promise.all([
            supabase.from("location_pdfs").select("id, location_id, storage_path, file_name").in("location_id", locationIds),
            supabase.from("location_approvals").select("location_id").eq("approved", true).in("location_id", locationIds),
          ]);
          const map: Record<string, any[]> = {};
          (printFiles || []).forEach((row: any) => {
            if (!map[row.location_id]) map[row.location_id] = [];
            map[row.location_id].push(row);
          });
          setPrintFilesByLocation(map);
          setApprovedLocationIds(new Set((approvals || []).map((r: any) => r.location_id)));
        } else {
          setPrintFilesByLocation({});
          setApprovedLocationIds(new Set());
        }
      } catch (error) {
        console.error("Error loading project:", error);
        toast.error("Fehler beim Laden des Projekts");
        navigate("/");
      } finally {
        setIsLoading(false);
      }
    };
    loadProject();
  }, [projectId, navigate]);

  const sortedLocations = useMemo(() => {
    if (!project) return [];
    return [...project.locations].sort((a, b) => naturalLocationSort(a.locationNumber, b.locationNumber));
  }, [project]);

  const sortedFloorPlans = useMemo(() => {
    if (!project?.floorPlans) return [];
    return [...project.floorPlans].sort((a, b) => (a.pageIndex - b.pageIndex) || a.name.localeCompare(b.name, "de", { numeric: true, sensitivity: "base" }));
  }, [project]);

  const getVisibleFields = (customerOnly: boolean) => {
    return mergeWithDefaultLocationFields(fieldConfigs).filter((field) => field.is_active && (!customerOnly || field.customer_visible));
  };

  const resolveFieldValue = (location: any, fieldKey: string) => {
    const customFields = location?.custom_fields && typeof location.custom_fields === "object"
      ? location.custom_fields
      : (location?.customFields && typeof location.customFields === "object" ? location.customFields : {});

    switch (fieldKey) {
      case "locationName":
        return location.location_name ?? location.locationName;
      case "system":
        return location.system;
      case "label":
        return location.label;
      case "locationType":
        return location.location_type ?? location.locationType;
      case "comment":
        return location.comment;
      default:
        return customFields?.[fieldKey];
    }
  };

  const handleDownloadImage = async (
    locationId: string,
    imageData: string,
    filename: string,
    type: 'annotated' | 'original'
  ) => {
    const key = `${locationId}-${type}`;
    setDownloadingImages(prev => ({ ...prev, [key]: true }));

    try {
      const success = await downloadImage(imageData, filename);
      if (success) {
        if (isIOSDevice()) {
          toast.success("Bild wird geladen - ggf. lange drücken zum Speichern");
        } else {
          toast.success("Bild heruntergeladen");
        }
      } else {
        toast.error("Download fehlgeschlagen");
      }
    } catch (error) {
      console.error("Download error:", error);
      toast.error("Fehler beim Download");
    } finally {
      setDownloadingImages(prev => ({ ...prev, [key]: false }));
    }
  };

  const exportAsZip = async () => {
    if (!project) return;

    setDownloadingZip(true);
    try {
      const zip = new JSZip();

      for (const location of sortedLocations) {
        const annotatedBlob = dataURItoBlob(location.imageData);
        zip.file(
          `${project.projectNumber}_${location.locationNumber}_bemasst.png`,
          annotatedBlob
        );

        const originalBlob = dataURItoBlob(location.originalImageData);
        zip.file(
          `${project.projectNumber}_${location.locationNumber}_original.png`,
          originalBlob
        );

        for (const [index, detail] of (location.detailImages || []).entries()) {
          const detailPrefix = `${project.projectNumber}_${location.locationNumber}_detail_${index + 1}`;
          if (detail.imageData) {
            zip.file(`${detailPrefix}_bemasst.png`, dataURItoBlob(detail.imageData));
          }
          if (detail.originalImageData) {
            zip.file(`${detailPrefix}_original.png`, dataURItoBlob(detail.originalImageData));
          }
        }
      }

      const zipBlob = await zip.generateAsync({ type: "blob" });
      const success = await downloadBlob(
        zipBlob,
        `Aufmass_${project.projectNumber}.zip`
      );

      if (success) {
        toast.success("ZIP-Datei wird heruntergeladen");
      } else {
        toast.error("ZIP-Download fehlgeschlagen");
      }
    } catch (error) {
      console.error("ZIP export error:", error);
      toast.error("Fehler beim ZIP-Export");
    } finally {
      setDownloadingZip(false);
    }
  };

  // Builds the export PDF and returns it as a Blob (or null). Both the
  // download button and the send-to-HERO button use this so they emit
  // an identical document. Hochformat, karten-basiert, im Stil der App:
  // pro Standort wird – wie in der Kunden-/Mitarbeiteransicht – die
  // Produktionsdatei als Hauptbild gezeigt (PDF via pdf.js gerendert) mit
  // dem Foto als Thumbnail; ohne Produktionsdatei das Foto selbst.
  type LocMedia = {
    main?: string; mainLabel: string;
    thumb?: string; thumbLabel?: string;
    extras: { src: string; label: string }[];
    printNames: string[];
  };

  const buildPdf = async (): Promise<Blob | null> => {
    if (!project) return null;
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const dateStr = new Date().toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });
    const customerOnly = pdfOptions.mode === "customer";
    const visibleFields = getVisibleFields(customerOnly);
    const showPrintFiles = customerOnly ? viewSettings.customerShowPrintFiles : viewSettings.internalShowPrintFiles;
    const showDetailImages = customerOnly ? viewSettings.customerShowDetailImages : viewSettings.internalShowDetailImages;

    // Build the media (rendered production pages + photo thumb) per location.
    const buildLocationMedia = async (location: any): Promise<LocMedia> => {
      const photo = location.imageData as string | undefined;
      const printFiles = printFilesByLocation[location.id] || [];
      const printNames = printFiles.map((p: any) => p.file_name);
      if (showPrintFiles && printFiles.length > 0) {
        const pages: { src: string; label: string }[] = [];
        for (const pf of printFiles) {
          const url = publicFileUrl(pf.storage_path);
          const isPdf = /\.pdf$/i.test(pf.file_name || "") || /\.pdf$/i.test(pf.storage_path || "");
          try {
            if (isPdf) {
              pages.push(...(await rasterizePdf(url, pf.file_name)));
            } else {
              const d = await urlToDataUrl(url);
              if (d) pages.push({ src: d, label: pf.file_name });
            }
          } catch { /* skip a broken file, keep going */ }
        }
        if (pages.length > 0) {
          return { main: pages[0].src, mainLabel: pages[0].label, thumb: photo, thumbLabel: "Foto", extras: pages.slice(1), printNames };
        }
      }
      return { main: photo, mainLabel: "Standortfoto", extras: [], printNames };
    };

    const buildFields = (location: any, printNames: string[]): FieldRow[] => {
      const rows: FieldRow[] = [];
      // Standard- + Custom-Felder (respektiert Kundensichtbarkeit/Reihenfolge),
      // Standortname steckt schon in der Kopfleiste, Kommentar separat.
      visibleFields
        .filter((f: any) => !["locationName", "comment"].includes(f.field_key))
        .forEach((f: any) => {
          const v = resolveFieldValue(location, f.field_key);
          if (v != null && String(v).trim()) {
            const dv = f.field_type === "checkbox" ? ((v === true || v === "true") ? "Ja" : "Nein") : String(v);
            rows.push({ label: f.field_label, value: dv });
          }
        });
      const commentField = visibleFields.find((f: any) => f.field_key === "comment");
      if ((commentField || !customerOnly) && location.comment) {
        rows.push({ label: commentField?.field_label || "Kommentar", value: location.comment, full: true });
      }
      if (showPrintFiles && printNames.length > 0) {
        rows.push({ label: "Produktionsdatei", value: printNames.join(", "), full: true });
      }
      return rows;
    };

    const pillFor = (location: any): { kind: PillKind } => {
      if (approvedLocationIds.has(location.id)) return { kind: "approved" };
      const open = (feedbackMap[location.id] || []).some((f) => f.author_type === "customer" && f.status === "open");
      return { kind: open ? "correction" : "open" };
    };

    // ── 1) Medien pro Standort vorab laden (beeinflusst die Seitenzählung) ──
    const mediaByLoc = new Map<string, LocMedia>();
    for (const location of sortedLocations) {
      mediaByLoc.set(location.id, await buildLocationMedia(location));
    }

    // ── 2) Seitenplan: Deckblatt(1) → Grundrisse → Standorte(+Extra/Detail) ──
    let page = 1; // Deckblatt
    const floorPlanPage = new Map<string, number>();
    for (const fp of sortedFloorPlans) floorPlanPage.set(fp.id, ++page);
    const locationPage = new Map<string, number>();
    for (const location of sortedLocations) {
      locationPage.set(location.id, ++page);
      const m = mediaByLoc.get(location.id)!;
      page += m.extras.length;
      if (showDetailImages && location.detailImages && location.detailImages.length > 0) page += 1;
    }

    // ── 3) Deckblatt ──────────────────────────────────────────────────────
    await drawCoverPage(pdf, {
      logoDataUri: companyLogo,
      title: "Aufmaß-Dokumentation",
      subtitle: customerOnly ? "Standort-Übersicht zur Freigabe" : "Internes Aufmaß-Protokoll",
      projectNumber: project.projectNumber,
      customerName: project.customerName,
      dateStr,
      locationCount: sortedLocations.length,
      floorPlanCount: sortedFloorPlans.length || undefined,
      locations: sortedLocations.map((l) => ({ number: l.locationNumber, name: l.locationName })),
    });

    // ── 4) Grundrissseiten (klickbare Marker → Standortseite) ──────────────
    for (const floorPlan of sortedFloorPlans) {
      pdf.addPage();
      const markers = floorPlan.markers
        .map((mk) => {
          const loc = sortedLocations.find((l) => l.id === mk.locationId);
          if (!loc) return null;
          return { x: mk.x, y: mk.y, short: shortLocationNumber(loc.locationNumber), pageLink: locationPage.get(loc.id) };
        })
        .filter(Boolean) as { x: number; y: number; short: string; pageLink?: number }[];
      await drawFloorPlanPage(pdf, {
        name: floorPlan.name,
        projectNumber: project.projectNumber,
        image: floorPlan.imageData,
        markers,
        pageNumber: floorPlanPage.get(floorPlan.id)!,
      });
    }

    // ── 5) Standortseiten ──────────────────────────────────────────────────
    for (const location of sortedLocations) {
      const m = mediaByLoc.get(location.id)!;
      let p = locationPage.get(location.id)!;
      pdf.addPage();
      await drawLocationPage(pdf, {
        number: location.locationNumber,
        name: location.locationName,
        projectNumber: project.projectNumber,
        pill: pillFor(location),
        mainImage: m.main,
        mainLabel: m.mainLabel,
        thumbImage: m.thumb,
        thumbLabel: m.thumbLabel,
        fields: buildFields(location, m.printNames),
        pageNumber: p,
      });

      // Zusätzliche Produktionsseiten (mehrseitige Druckdateien)
      for (const ex of m.extras) {
        pdf.addPage();
        p += 1;
        await drawMediaPage(pdf, {
          title: `Standort ${location.locationNumber} · Produktionsdatei`,
          sub: `${location.locationName ? location.locationName + "  ·  " : ""}Projekt ${project.projectNumber}`,
          image: ex.src,
          label: ex.label,
          pageNumber: p,
        });
      }

      // Detailbilder
      if (showDetailImages && location.detailImages && location.detailImages.length > 0) {
        pdf.addPage();
        p += 1;
        await drawDetailPage(pdf, {
          number: location.locationNumber,
          name: location.locationName,
          projectNumber: project.projectNumber,
          images: location.detailImages.map((d: any) => ({ src: d.imageData, caption: d.caption })),
          pageNumber: p,
        });
      }
    }

    return pdf.output("blob");
  };

  const exportAsPDF = async () => {
    if (!project) return;
    setDownloadingPDF(true);
    try {
      const customerOnly = pdfOptions.mode === "customer";
      const pdfBlob = await buildPdf();
      if (!pdfBlob) { toast.error("PDF konnte nicht erstellt werden"); return; }
      const success = await downloadBlob(pdfBlob, `${project.projectNumber}_${customerOnly ? "Kundenexport" : "InternerExport"}.pdf`);
      if (success) toast.success("PDF wird heruntergeladen");
      else toast.error("PDF-Download fehlgeschlagen");
    } catch (error) {
      console.error("PDF export error:", error);
      toast.error("Fehler beim PDF-Export");
    } finally {
      setDownloadingPDF(false);
    }
  };

  // Push the export PDF into the HERO upload queue as an aufmass_pdf
  // document. Reuses the same queue/worker/proxy chain as images and
  // warehouse labels (document_type_id resolved server-side from admin
  // config).
  const sendPdfToHero = async () => {
    if (!project) return;
    const heroId = getHeroProjectMatchId(project);
    if (!heroId) { toast.error("Projekt ist nicht mit HERO verknüpft"); return; }
    setSendingToHero(true);
    try {
      const pdfBlob = await buildPdf();
      if (!pdfBlob) { toast.error("PDF konnte nicht erstellt werden"); return; }
      await enqueueHeroUploadIfLinked({
        project,
        uploadType: "aufmass_pdf",
        blob: pdfBlob,
        filename: `${project.projectNumber}_Aufmass.pdf`,
      });
      toast.success("Aufmaß wird an HERO gesendet ✓");
    } catch (e: any) {
      console.error("HERO send error:", e);
      toast.error("Fehler beim Senden an HERO: " + (e.message || String(e)));
    } finally {
      setSendingToHero(false);
    }
  };

  if (isLoading) {
    return <div className="min-h-screen bg-background flex items-center justify-center"><div className="text-muted-foreground">Laden...</div></div>;
  }
  if (!project) return null;

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-2xl mx-auto p-4 space-y-6">
        <Button variant="ghost" onClick={() => navigate(`/projects/${projectId}`)}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Zurück
        </Button>

        <div>
          <h1 className="text-3xl font-bold">Export</h1>
          <p className="text-muted-foreground mt-1">Projekt {project.projectNumber} exportieren</p>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-3"><FileText className="h-5 w-5 text-primary" /> PDF-Dokument</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-3">Das PDF orientiert sich optisch an der App. Du wählst nur noch zwischen interner und Kundenansicht.</p>
            <PDFExportOptionsUI options={pdfOptions} onChange={setPdfOptions} />
            <Button onClick={exportAsPDF} disabled={downloadingPDF} className="w-full mt-4">
              {downloadingPDF ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />} PDF herunterladen
            </Button>
            {getHeroProjectMatchId(project) && (
              <Button
                onClick={sendPdfToHero}
                disabled={sendingToHero || downloadingPDF}
                variant="secondary"
                className="w-full mt-2"
              >
                {sendingToHero ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />} An HERO senden
              </Button>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-3"><Archive className="h-5 w-5 text-primary" /> Alle Bilder als ZIP</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-3">Alle Standortbilder und Detailbilder (bemaßt + original) in einer ZIP-Datei</p>
            <Button onClick={exportAsZip} disabled={downloadingZip} variant="secondary" className="w-full">
              {downloadingZip ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />} ZIP herunterladen
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-3"><FileImage className="h-5 w-5 text-primary" /> Einzelne Bilder</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">Standortbilder und Detailbilder einzeln herunterladen</p>
            {sortedLocations.map((location) => (
              <div key={location.id} className="border rounded-lg p-3 space-y-3">
                <div className="font-medium text-sm">Standort {location.locationNumber}{location.locationName && <span className="text-muted-foreground font-normal ml-2">{location.locationName}</span>}</div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="flex-1" disabled={downloadingImages[`${location.id}-annotated`]} onClick={() => handleDownloadImage(location.id, location.imageData, `${project.projectNumber}_${location.locationNumber}_bemasst.png`, 'annotated')}>
                    {downloadingImages[`${location.id}-annotated`] ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <FileImage className="h-3 w-3 mr-1" />} Standort bemaßt
                  </Button>
                  <Button size="sm" variant="outline" className="flex-1" disabled={downloadingImages[`${location.id}-original`]} onClick={() => handleDownloadImage(location.id, location.originalImageData, `${project.projectNumber}_${location.locationNumber}_original.png`, 'original')}>
                    {downloadingImages[`${location.id}-original`] ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <FileImage className="h-3 w-3 mr-1" />} Standort original
                  </Button>
                </div>

                {location.detailImages && location.detailImages.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-muted-foreground">Detailbilder</div>
                    {location.detailImages.map((detail, index) => (
                      <div key={detail.id} className="rounded border p-2 space-y-2">
                        <div className="text-xs">Detailbild {index + 1}{detail.caption ? <span className="text-muted-foreground ml-2">{detail.caption}</span> : null}</div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex-1"
                            disabled={downloadingImages[`${detail.id}-annotated`]}
                            onClick={() => handleDownloadImage(detail.id, detail.imageData, `${project.projectNumber}_${location.locationNumber}_detail_${index + 1}_bemasst.png`, 'annotated')}
                          >
                            {downloadingImages[`${detail.id}-annotated`] ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <FileImage className="h-3 w-3 mr-1" />} Bemaßt
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex-1"
                            disabled={downloadingImages[`${detail.id}-original`]}
                            onClick={() => handleDownloadImage(detail.id, detail.originalImageData, `${project.projectNumber}_${location.locationNumber}_detail_${index + 1}_original.png`, 'original')}
                          >
                            {downloadingImages[`${detail.id}-original`] ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <FileImage className="h-3 w-3 mr-1" />} Original
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};



function naturalLocationSort(a: string, b: string) {
  return a.localeCompare(b, "de", { numeric: true, sensitivity: "base" });
}

function shortLocationNumber(locationNumber: string) {
  const parts = locationNumber.split("-");
  return parts[parts.length - 1] || locationNumber;
}

export default Export;
