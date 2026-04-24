import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, FileImage, FileText, Download, Archive, Loader2, Upload, CheckCircle2 } from "lucide-react";
import { indexedDBStorage } from "@/lib/indexedDBStorage";
import { Project } from "@/types/project";
import { toast } from "sonner";
import jsPDF from "jspdf";
import JSZip from "jszip";
import {
  downloadImage,
  downloadBlob,
  dataURItoBlob,
  isIOSDevice,
} from "@/lib/exportUtils";
import PDFExportOptionsUI, { PDFExportOptions, defaultPDFOptions } from "@/components/PDFExportOptions";
import {
  getImageDimensions,
  drawLocationPageLandscape,
  drawFooter,
  FooterData,
  FooterRow,
  MARGIN,
  PAGE_W,
  PAGE_H,
  BLUE,
  DARK,
  CONTENT_WIDTH,
} from "@/lib/pdfHelpers";
import { mergeWithDefaultLocationFields } from "@/lib/customerFields";
import { mergeWithDefaultProjectFields, getProjectFieldValue } from "@/lib/projectFields";
import { supabase } from "@/integrations/supabase/client";
import { hydrateProjectFromSupabase } from "@/lib/supabaseSync";
import { fetchViewSettings, defaultViewSettings } from "@/lib/viewSettings";
import { enqueueHeroUploadIfLinked, getHeroProjectMatchId } from "@/lib/heroSyncHelpers";

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
  status: "open" | "done";
  created_at: string;
};

const Export = () => {
  const { projectId } = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [fieldConfigs, setFieldConfigs] = useState<FieldConfig[]>([]);
  const [projectFieldConfigs, setProjectFieldConfigs] = useState<any[]>([]);
  const [feedbackMap, setFeedbackMap] = useState<Record<string, FeedbackItem[]>>({});
  const [printFilesByLocation, setPrintFilesByLocation] = useState<Record<string, any[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [downloadingPDF, setDownloadingPDF] = useState(false);
  const [uploadingToHero, setUploadingToHero] = useState(false);
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
            .select("id, location_id, message, author_name, status, created_at")
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
          const { data: printFiles } = await supabase
            .from("location_pdfs")
            .select("id, location_id, storage_path, file_name")
            .in("location_id", locationIds);
          const map: Record<string, any[]> = {};
          (printFiles || []).forEach((row: any) => {
            if (!map[row.location_id]) map[row.location_id] = [];
            map[row.location_id].push(row);
          });
          setPrintFilesByLocation(map);
        } else {
          setPrintFilesByLocation({});
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

  // Internal: builds the PDF and returns a Blob. Shared between "download"
  // and "upload to HERO" actions so we only have one place that knows how
  // to render the document.
  const buildPDFBlob = async (customerOnly: boolean): Promise<{ blob: Blob; filename: string }> => {
    if (!project) throw new Error("Kein Projekt geladen");
    // Querformat für Standortseiten
    const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const dateStr = new Date().toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });
    const visibleFields = getVisibleFields(customerOnly);

      const locationPageMap: Record<string, number> = {};
      const floorPlanPageMap: Record<string, number> = {};
      let pageCounter = 1;

      // Grundrisse bleiben im Hochformat → eigene Seiten zählen
      for (const fp of sortedFloorPlans) floorPlanPageMap[fp.id] = pageCounter++;
      for (const location of sortedLocations) {
        locationPageMap[location.id] = pageCounter++;
        if (((customerOnly && viewSettings.customerShowDetailImages) || (!customerOnly && viewSettings.internalShowDetailImages)) && location.detailImages && location.detailImages.length > 0) {
          pageCounter++;
        }
      }
      const totalPages = pageCounter - 1;

      // Grundrissseiten (Hochformat – eigene addPage mit orientation)
      let firstPage = true;
      for (const floorPlan of sortedFloorPlans) {
        if (!firstPage) pdf.addPage("a4", "landscape");
        firstPage = false;
        const currentPage = floorPlanPageMap[floorPlan.id];
        // Grundriss im Querformat darstellen
        const fpDims = await getImageDimensions(floorPlan.imageData);
        const maxW = PAGE_W - 2 * MARGIN;
        const maxH = PAGE_H - 2 * MARGIN - 12;
        const fpRatio = Math.min(maxW / fpDims.width, maxH / fpDims.height);
        const fpW = fpDims.width * fpRatio;
        const fpH = fpDims.height * fpRatio;
        const fpX = MARGIN + (maxW - fpW) / 2;
        const fpY = MARGIN + 10;

        pdf.setFontSize(8);
        pdf.setFont("helvetica", "bold");
        pdf.setTextColor(DARK.r, DARK.g, DARK.b);
        pdf.text(`Grundriss · ${floorPlan.name}`, MARGIN, MARGIN + 6);

        const fmt = floorPlan.imageData.startsWith("data:image/jpeg") ? "JPEG"
                  : floorPlan.imageData.startsWith("data:image/webp") ? "WEBP" : "PNG";
        try { pdf.addImage(floorPlan.imageData, fmt as any, fpX, fpY, fpW, fpH); } catch {}

        for (const marker of floorPlan.markers) {
          const loc = sortedLocations.find(l => l.id === marker.locationId);
          if (!loc) continue;
          const mx = fpX + marker.x * fpW;
          const my = fpY + marker.y * fpH;
          const shortNum = shortLocationNumber(loc.locationNumber);
          const targetPage = locationPageMap[loc.id];
          if (targetPage) pdf.link(mx - 4, my - 4, 8, 8, { pageNumber: targetPage });
          pdf.setFillColor(BLUE.r, BLUE.g, BLUE.b);
          pdf.circle(mx, my, 2.5, "F");
          pdf.setFontSize(5);
          pdf.setFont("helvetica", "bold");
          pdf.setTextColor(255, 255, 255);
          pdf.text(shortNum, mx, my + 0.8, { align: "center" });
        }
      }

      // Standortseiten
      for (const location of sortedLocations) {
        if (!firstPage) pdf.addPage("a4", "landscape");
        firstPage = false;

        // Footer-Daten aufbauen
        const parentFP = sortedFloorPlans.find(fp => fp.markers.some(m => m.locationId === location.id));
        const printFiles = printFilesByLocation[location.id] || [];
        const showPrintFiles = customerOnly ? viewSettings.customerShowPrintFiles : viewSettings.internalShowPrintFiles;

        // Spalte 1: Projekt-Pflichtfelder + konfigurierte Projektfelder
        const col1: FooterRow[] = [
          { label: "Stand",     value: dateStr },
          ...(employeeName ? [{ label: "Zeichner", value: employeeName }] : []),
          { label: "Projektnr.", value: project.projectNumber },
        ];
        if (project.customerName) col1.push({ label: "Kunde", value: project.customerName });
        mergeWithDefaultProjectFields(projectFieldConfigs || [])
          .filter((f: any) => f.is_active)
          .forEach((f: any) => {
            const v = getProjectFieldValue(project, f.field_key);
            if (v && String(v).trim()) col1.push({ label: f.field_label, value: String(v) });
          });

        // Spalte 2: Standort-Pflichtfelder + optional + Plan
        const col2: FooterRow[] = [
          { label: "Standortnr.", value: location.locationNumber },
        ];
        if (location.locationName) col2.push({ label: "Standortname", value: location.locationName });
        if (location.comment) col2.push({ label: "Kommentar", value: location.comment });
        if (parentFP) {
          col2.push({
            label: "Plan",
            value: parentFP.name,
            pink: true,
            pageLink: floorPlanPageMap[parentFP.id],
          });
        }
        // Konfigurierte Standortfelder für Spalte 2 (nicht System/Art/Beschriftung/Format)
        const col2FieldKeys = new Set(["system", "label", "locationType"]);
        visibleFields
          .filter((f: any) => !col2FieldKeys.has(f.field_key))
          .forEach((f: any) => {
            const v = resolveFieldValue(location, f.field_key);
            if (v && String(v).trim()) {
              const displayVal = f.field_type === "checkbox"
                ? ((v === true || v === "true") ? "Ja" : "Nein")
                : String(v);
              col2.push({ label: f.field_label, value: displayVal, pink: false });
            }
          });
        // Produktionsdatei
        if (showPrintFiles && printFiles.length > 0) {
          printFiles.forEach((pf: any) => {
            col2.push({ label: "Produktionsdatei", value: pf.file_name, pink: true });
          });
        }

        // Spalte 3: System, Art, Beschriftung + weitere konfigurierte Felder
        const col3: FooterRow[] = [];
        if (location.system) col3.push({ label: "System", value: location.system });
        if (location.locationType) col3.push({ label: "Art", value: location.locationType });
        if (location.label) col3.push({ label: "Beschriftung", value: location.label });
        visibleFields
          .filter((f: any) => col2FieldKeys.has(f.field_key) && !["system", "locationType", "label"].includes(f.field_key))
          .forEach((f: any) => {
            const v = resolveFieldValue(location, f.field_key);
            if (v && String(v).trim()) col3.push({ label: f.field_label, value: String(v) });
          });

        const footer: FooterData = {
          col1: col1.slice(0, 5),
          col2: col2.slice(0, 5),
          col3: col3.slice(0, 5),
          logoDataUri: companyLogo,
        };

        await drawLocationPageLandscape({ pdf, imageData: location.imageData, footer });

        // Detailbilder
        if (((customerOnly && viewSettings.customerShowDetailImages) || (!customerOnly && viewSettings.internalShowDetailImages)) && location.detailImages && location.detailImages.length > 0) {
          pdf.addPage("a4", "landscape");
          await drawDetailImagesPage({
            pdf,
            projectNumber: project.projectNumber,
            location,
            dateStr,
            currentPage: locationPageMap[location.id] + 1,
            totalPages,
            companyLogo,
          });
        }
      }

      const pdfBlob = pdf.output("blob");
      const filename = `${project.projectNumber}_${customerOnly ? "Kundenexport" : "InternerExport"}.pdf`;
      return { blob: pdfBlob, filename };
  };

  // User action: generate PDF and trigger download in the browser.
  const exportAsPDF = async () => {
    if (!project) return;
    setDownloadingPDF(true);
    try {
      const customerOnly = pdfOptions.mode === "customer";
      const { blob, filename } = await buildPDFBlob(customerOnly);
      const success = await downloadBlob(blob, filename);
      if (success) toast.success("PDF wird heruntergeladen");
      else toast.error("PDF-Download fehlgeschlagen");
    } catch (error) {
      console.error("PDF export error:", error);
      toast.error("Fehler beim PDF-Export");
    } finally {
      setDownloadingPDF(false);
    }
  };

  // User action: generate PDF and queue it for upload to HERO. Only
  // visible when the project is linked to HERO (see button below).
  const uploadPDFToHero = async () => {
    if (!project) return;
    setUploadingToHero(true);
    try {
      const customerOnly = pdfOptions.mode === "customer";
      const { blob, filename } = await buildPDFBlob(customerOnly);
      await enqueueHeroUploadIfLinked({
        project,
        uploadType: "aufmass_pdf",
        blob,
        filename,
      });
      toast.success("Aufmaß-PDF wird zu HERO übertragen...");
    } catch (error) {
      console.error("HERO PDF upload error:", error);
      toast.error("Fehler bei der HERO-Übertragung");
    } finally {
      setUploadingToHero(false);
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
            {/* Only shown when the project is linked to HERO. For projects
                without HERO integration (local-only) this button would be
                useless and confusing, so it's hidden entirely. */}
            {getHeroProjectMatchId(project) && (
              <Button onClick={uploadPDFToHero} disabled={uploadingToHero} variant="outline" className="w-full mt-2">
                {uploadingToHero ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />} PDF nach HERO senden
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

async function drawDetailImagesPage({ pdf, projectNumber, location, dateStr, companyLogo }: any) {
  // Querformat – Detailbilder nebeneinander über dem Footer
  const FOOTER_H_D = 12;
  const contentH = PAGE_H - 2 * MARGIN - FOOTER_H_D;
  let y = MARGIN;

  pdf.setFontSize(8);
  pdf.setFont("helvetica", "bold");
  pdf.setTextColor(DARK.r, DARK.g, DARK.b);
  pdf.text(`Detailbilder · Standort ${location.locationNumber}`, MARGIN, y + 4);
  y += 8;

  const maxW = (PAGE_W - 2 * MARGIN - 6) / 2;
  const maxH = contentH - 10;
  let col = 0;
  for (const detail of location.detailImages) {
    const dims = await getImageDimensions(detail.imageData);
    const ratio = Math.min(maxW / dims.width, maxH / dims.height);
    const w = dims.width * ratio;
    const h = dims.height * ratio;
    const x = MARGIN + col * (maxW + 6) + (maxW - w) / 2;
    if (y + h + 10 > PAGE_H - MARGIN - FOOTER_H_D) {
      pdf.addPage("a4", "landscape");
      y = MARGIN + 8;
      col = 0;
    }
    const fmt = detail.imageData.startsWith("data:image/jpeg") ? "JPEG"
              : detail.imageData.startsWith("data:image/webp") ? "WEBP" : "PNG";
    try { pdf.addImage(detail.imageData, fmt as any, x, y, w, h); } catch {}
    if (detail.caption) {
      pdf.setFontSize(6);
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(100, 100, 100);
      pdf.text(detail.caption, x, y + h + 3, { maxWidth: maxW });
    }
    if (col === 1) {
      col = 0;
      y += maxH + 12;
    } else {
      col = 1;
    }
  }
}

export default Export;
