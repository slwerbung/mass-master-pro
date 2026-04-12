import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, FileImage, FileText, Download, Archive, Loader2 } from "lucide-react";
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
  MARGIN,
  CONTENT_WIDTH,
  PAGE_W,
  PAGE_H,
  BLUE,
} from "@/lib/pdfHelpers";
import { mergeWithDefaultLocationFields } from "@/lib/customerFields";
import { mergeWithDefaultProjectFields, getProjectFieldValue } from "@/lib/projectFields";
import { supabase } from "@/integrations/supabase/client";
import { hydrateProjectFromSupabase } from "@/lib/supabaseSync";
import { fetchViewSettings, defaultViewSettings } from "@/lib/viewSettings";

// Local design tokens (landscape layout owns these)
const TEXT_PRIMARY = { r: 31, g: 41, b: 55 };
const TEXT_MUTED   = { r: 107, g: 114, b: 128 };

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
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [downloadingImages, setDownloadingImages] = useState<Record<string, boolean>>({});
  const [pdfOptions, setPdfOptions] = useState<PDFExportOptions>(defaultPDFOptions);
  const [viewSettings, setViewSettings] = useState(defaultViewSettings);
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

        let loadedProject = await hydrateProjectFromSupabase(projectId);
        if (!loadedProject) {
          const localProject = await indexedDBStorage.getProject(projectId);
          loadedProject = localProject;
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

  const exportAsPDF = async () => {
    if (!project) return;

    setDownloadingPDF(true);
    try {
      const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const dateStr = new Date().toLocaleDateString("de-DE");
      const customerOnly = pdfOptions.mode === "customer";
      const visibleFields = getVisibleFields(customerOnly);
      const modeLabel = customerOnly ? "Kunden-Export" : "Interner Export";

      const locationPageMap: Record<string, number> = {};
      const floorPlanPageMap: Record<string, number> = {};
      let pageCounter = 2;

      for (const fp of sortedFloorPlans) floorPlanPageMap[fp.id] = pageCounter++;
      for (const location of sortedLocations) {
        locationPageMap[location.id] = pageCounter++;
        if (((customerOnly && viewSettings.customerShowDetailImages) || (!customerOnly && viewSettings.internalShowDetailImages)) && location.detailImages && location.detailImages.length > 0) {
          pageCounter++;
        }
      }
      const totalPages = pageCounter - 1;

      // Cover page (landscape 297×210)
      pdf.setDrawColor(BLUE.r, BLUE.g, BLUE.b);
      pdf.setLineWidth(2);
      pdf.line(MARGIN, 60, PAGE_W - MARGIN, 60);
      pdf.setFontSize(32);
      pdf.setFont("helvetica", "bold");
      pdf.setTextColor(TEXT_PRIMARY.r, TEXT_PRIMARY.g, TEXT_PRIMARY.b);
      pdf.text("Aufmaß-Bericht", MARGIN, 80);
      pdf.setFontSize(20);
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(BLUE.r, BLUE.g, BLUE.b);
      pdf.text(`Projekt ${project.projectNumber}`, MARGIN, 95);
      pdf.setFontSize(11);
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(TEXT_MUTED.r, TEXT_MUTED.g, TEXT_MUTED.b);
      const coverDate = new Date().toLocaleDateString("de-DE", { day: "2-digit", month: "long", year: "numeric" });
      const typeLabel = project.projectType === "aufmass_mit_plan" ? "Aufmaß mit Plan" : "Aufmaß";
      pdf.text(`Datum: ${coverDate}`, MARGIN, 115);
      pdf.text(`Typ: ${typeLabel}`, MARGIN, 123);
      pdf.text(`Standorte: ${sortedLocations.length}`, MARGIN, 131);
      pdf.text(modeLabel, MARGIN, 139);
      drawFooter(pdf, dateStr, 1, totalPages);

      for (const floorPlan of sortedFloorPlans) {
        pdf.addPage();
        const currentPage = floorPlanPageMap[floorPlan.id];
        drawHeader(pdf, project.projectNumber);
        drawFooter(pdf, dateStr, currentPage, totalPages);
        let y = MARGIN + 16;

        pdf.setFontSize(14);
        pdf.setFont("helvetica", "bold");
        pdf.setTextColor(TEXT_PRIMARY.r, TEXT_PRIMARY.g, TEXT_PRIMARY.b);
        pdf.text(`Grundriss · ${floorPlan.name}`, MARGIN, y);
        y += 8;

        const fpDims = await getImageDimensions(floorPlan.imageData);
        const fpMaxH = PAGE_H - y - MARGIN - 18;
        const fpRatio = Math.min(CONTENT_WIDTH / fpDims.width, fpMaxH / fpDims.height);
        const fpW = fpDims.width * fpRatio;
        const fpH = fpDims.height * fpRatio;
        const fpX = MARGIN + (CONTENT_WIDTH - fpW) / 2;

        drawImg(pdf, floorPlan.imageData, fpX, y, fpW, fpH);

        for (const marker of floorPlan.markers) {
          const loc = sortedLocations.find(l => l.id === marker.locationId);
          if (!loc) continue;
          const mx = fpX + marker.x * fpW;
          const my = y + marker.y * fpH;
          const shortNum = shortLocationNumber(loc.locationNumber);
          const targetPage = locationPageMap[loc.id];
          if (targetPage) pdf.link(mx - 4, my - 4, 8, 8, { pageNumber: targetPage });
          pdf.setFillColor(BLUE.r, BLUE.g, BLUE.b);
          pdf.circle(mx, my, 2.5, 'F');
          pdf.setFontSize(6);
          pdf.setFont("helvetica", "bold");
          pdf.setTextColor(255, 255, 255);
          pdf.text(shortNum, mx, my + 0.8, { align: "center" });
        }
      }

      for (const location of sortedLocations) {
        pdf.addPage();
        await drawLocationPage({
          pdf,
          project,
          location,
          visibleFields,
          customerOnly,
          feedbacks: feedbackMap[location.id] || [],
          printFiles: printFilesByLocation[location.id] || [],
          showPrintFiles: customerOnly ? viewSettings.customerShowPrintFiles : viewSettings.internalShowPrintFiles,
          projectFieldConfigs,
          dateStr,
          currentPage: locationPageMap[location.id],
          totalPages,
          floorPlanPageMap,
          sortedFloorPlans,
          resolveFieldValue,
        });

        if (((customerOnly && viewSettings.customerShowDetailImages) || (!customerOnly && viewSettings.internalShowDetailImages)) && location.detailImages && location.detailImages.length > 0) {
          pdf.addPage();
          await drawDetailImagesPage({
            pdf,
            projectNumber: project.projectNumber,
            location,
            dateStr,
            currentPage: locationPageMap[location.id] + 1,
            totalPages,
          });
        }
      }

      const pdfBlob = pdf.output("blob");
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

// ── Utility ──────────────────────────────────────────────────────────────────

function naturalLocationSort(a: string, b: string) {
  return a.localeCompare(b, "de", { numeric: true, sensitivity: "base" });
}

function shortLocationNumber(locationNumber: string) {
  const parts = locationNumber.split("-");
  return parts[parts.length - 1] || locationNumber;
}

// ── Local PDF helpers (A4 landscape 297×210) ─────────────────────────────────

function drawImg(pdf: jsPDF, dataURI: string, x: number, y: number, w: number, h: number) {
  const fmt = dataURI.startsWith("data:image/jpeg") ? "JPEG"
            : dataURI.startsWith("data:image/webp")  ? "WEBP"
            : "PNG";
  try { pdf.addImage(dataURI, fmt as any, x, y, w, h); } catch (e) { console.error("addImage error", e); }
  pdf.setDrawColor(209, 213, 219);
  pdf.setLineWidth(0.3);
  pdf.rect(x, y, w, h, "S");
}

function drawHeader(pdf: jsPDF, projectNumber: string) {
  pdf.setDrawColor(BLUE.r, BLUE.g, BLUE.b);
  pdf.setLineWidth(0.8);
  pdf.line(MARGIN, 12, PAGE_W - MARGIN, 12);
  pdf.setFontSize(8);
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(TEXT_MUTED.r, TEXT_MUTED.g, TEXT_MUTED.b);
  pdf.text(`Projekt ${projectNumber}`, PAGE_W - MARGIN, 10, { align: "right" });
}

function drawFooter(pdf: jsPDF, date: string, pageNum: number, totalPages: number) {
  const footerY = PAGE_H - 12;
  pdf.setDrawColor(209, 213, 219);
  pdf.setLineWidth(0.3);
  pdf.line(MARGIN, footerY - 3, PAGE_W - MARGIN, footerY - 3);
  pdf.setFontSize(7);
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(TEXT_MUTED.r, TEXT_MUTED.g, TEXT_MUTED.b);
  pdf.text(date, MARGIN, footerY);
  pdf.text(`Seite ${pageNum} / ${totalPages}`, PAGE_W - MARGIN, footerY, { align: "right" });
}

// ── Page renderers ────────────────────────────────────────────────────────────

async function drawLocationPage({ pdf, project, location, visibleFields, customerOnly, feedbacks, printFiles, showPrintFiles, dateStr, currentPage, totalPages, floorPlanPageMap, sortedFloorPlans, resolveFieldValue, projectFieldConfigs }: any) {
  drawHeader(pdf, project.projectNumber);
  drawFooter(pdf, dateStr, currentPage, totalPages);
  let y = MARGIN + 16;

  const parentFloorPlan = sortedFloorPlans.find((fp: any) => fp.markers.some((m: any) => m.locationId === location.id));
  if (parentFloorPlan) {
    const targetPage = floorPlanPageMap[parentFloorPlan.id];
    if (targetPage) {
      pdf.setFontSize(8);
      pdf.setTextColor(BLUE.r, BLUE.g, BLUE.b);
      pdf.textWithLink(`← Grundriss: ${parentFloorPlan.name}`, MARGIN, y, { pageNumber: targetPage });
      y += 6;
    }
  }

  pdf.setFontSize(17);
  pdf.setFont("helvetica", "bold");
  pdf.setTextColor(TEXT_PRIMARY.r, TEXT_PRIMARY.g, TEXT_PRIMARY.b);
  pdf.text(`Standort ${location.locationNumber}`, MARGIN, y + 2);
  y += 8;

  if (location.locationName) {
    pdf.setFontSize(10);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(TEXT_MUTED.r, TEXT_MUTED.g, TEXT_MUTED.b);
    pdf.text(location.locationName, MARGIN, y + 1);
    y += 6;
  }

  const imgDims = await getImageDimensions(location.imageData);
  const imageMaxH = PAGE_H - y - MARGIN - 20;
  const imageRatio = Math.min(CONTENT_WIDTH / imgDims.width, imageMaxH / imgDims.height);
  const imageW = imgDims.width * imageRatio;
  const imageH = imgDims.height * imageRatio;
  const imageX = MARGIN + (CONTENT_WIDTH - imageW) / 2;
  drawImg(pdf, location.imageData, imageX, y, imageW, imageH);
}

async function drawDetailImagesPage({ pdf, projectNumber, location, dateStr, currentPage, totalPages }: any) {
  drawHeader(pdf, projectNumber);
  drawFooter(pdf, dateStr, currentPage, totalPages);
  let y = MARGIN + 16;
  pdf.setFontSize(13);
  pdf.setFont("helvetica", "bold");
  pdf.setTextColor(TEXT_PRIMARY.r, TEXT_PRIMARY.g, TEXT_PRIMARY.b);
  pdf.text(`Detailbilder · Standort ${location.locationNumber}`, MARGIN, y);
  y += 8;

  const maxW = (CONTENT_WIDTH - 6) / 2;
  const maxH = 72;
  let col = 0;
  for (const detail of location.detailImages) {
    const dims = await getImageDimensions(detail.imageData);
    const ratio = Math.min(maxW / dims.width, maxH / dims.height);
    const w = dims.width * ratio;
    const h = dims.height * ratio;
    const x = MARGIN + col * (maxW + 6) + (maxW - w) / 2;
    if (y + h + 14 > PAGE_H - MARGIN) {
      pdf.addPage();
      drawHeader(pdf, projectNumber);
      y = MARGIN + 16;
      col = 0;
    }
    drawImg(pdf, detail.imageData, x, y, w, h);
    if (detail.caption) {
      pdf.setFontSize(8);
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(TEXT_MUTED.r, TEXT_MUTED.g, TEXT_MUTED.b);
      const captionLines = pdf.splitTextToSize(detail.caption, maxW);
      pdf.text(captionLines, x, y + h + 4);
    }
    if (col === 1) {
      col = 0;
      y += maxH + 18;
    } else {
      col = 1;
    }
  }
}

export default Export;
