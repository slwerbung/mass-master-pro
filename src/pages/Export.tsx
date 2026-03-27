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
  drawPageHeader,
  drawPageFooter,
  drawCoverPage,
  drawImageWithBorder,
  MARGIN,
  CONTENT_WIDTH,
  PAGE_HEIGHT,
  BLUE,
  TEXT_PRIMARY,
  TEXT_MUTED,
  PAGE_WIDTH,
} from "@/lib/pdfHelpers";
import { mergeWithDefaultLocationFields } from "@/lib/customerFields";
import { supabase } from "@/integrations/supabase/client";
import { hydrateProjectFromSupabase } from "@/lib/supabaseSync";

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
  const [feedbackMap, setFeedbackMap] = useState<Record<string, FeedbackItem[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [downloadingPDF, setDownloadingPDF] = useState(false);
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [downloadingImages, setDownloadingImages] = useState<Record<string, boolean>>({});
  const [pdfOptions, setPdfOptions] = useState<PDFExportOptions>(defaultPDFOptions);
  const navigate = useNavigate();

  useEffect(() => {
    const loadProject = async () => {
      if (!projectId) return;
      try {
        const [localProject, fieldsRes, feedbackRes] = await Promise.all([
          indexedDBStorage.getProject(projectId),
          supabase
            .from("location_field_config")
            .select("id, field_key, field_label, field_type, is_active, customer_visible, sort_order")
            .order("sort_order"),
          supabase
            .from("location_feedback")
            .select("id, location_id, message, author_name, status, created_at")
            .order("created_at", { ascending: true }),
        ]);

        const needsHydration = !localProject || projectNeedsHydration(localProject);
        const loadedProject = needsHydration ? (await hydrateProjectFromSupabase(projectId)) || localProject : localProject;

        if (!loadedProject) {
          toast.error("Projekt nicht gefunden");
          navigate("/");
          return;
        }

        setProject(loadedProject);
        setFieldConfigs((fieldsRes.data || []) as FieldConfig[]);

        const nextFeedbackMap: Record<string, FeedbackItem[]> = {};
        (feedbackRes.data || []).forEach((entry: any) => {
          if (!nextFeedbackMap[entry.location_id]) nextFeedbackMap[entry.location_id] = [];
          nextFeedbackMap[entry.location_id].push(entry as FeedbackItem);
        });
        setFeedbackMap(nextFeedbackMap);
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
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
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
        if (!customerOnly && location.detailImages && location.detailImages.length > 0) {
          pageCounter++;
        }
      }
      const totalPages = pageCounter - 1;

      drawCoverPage(pdf, project.projectNumber, sortedLocations.length, project.projectType);
      pdf.setFontSize(11);
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(TEXT_MUTED.r, TEXT_MUTED.g, TEXT_MUTED.b);
      pdf.text(modeLabel, MARGIN, 166);
      drawPageFooter(pdf, dateStr, 1, totalPages);

      for (const floorPlan of sortedFloorPlans) {
        pdf.addPage();
        const currentPage = floorPlanPageMap[floorPlan.id];
        drawPageHeader(pdf, project.projectNumber);
        drawPageFooter(pdf, dateStr, currentPage, totalPages);
        let y = MARGIN + 16;

        pdf.setFontSize(14);
        pdf.setFont("helvetica", "bold");
        pdf.setTextColor(TEXT_PRIMARY.r, TEXT_PRIMARY.g, TEXT_PRIMARY.b);
        pdf.text(`Grundriss · ${floorPlan.name}`, MARGIN, y);
        y += 8;

        const fpDims = await getImageDimensions(floorPlan.imageData);
        const fpMaxH = PAGE_HEIGHT - y - MARGIN - 18;
        const fpRatio = Math.min(CONTENT_WIDTH / fpDims.width, fpMaxH / fpDims.height);
        const fpW = fpDims.width * fpRatio;
        const fpH = fpDims.height * fpRatio;
        const fpX = MARGIN + (CONTENT_WIDTH - fpW) / 2;

        drawImageWithBorder(pdf, floorPlan.imageData, fpX, y, fpW, fpH);

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
        drawLocationPage({
          pdf,
          project,
          location,
          visibleFields,
          customerOnly,
          feedbacks: feedbackMap[location.id] || [],
          dateStr,
          currentPage: locationPageMap[location.id],
          totalPages,
          floorPlanPageMap,
          sortedFloorPlans,
          resolveFieldValue,
        });

        if (!customerOnly && location.detailImages && location.detailImages.length > 0) {
          pdf.addPage();
          drawDetailImagesPage({
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
            <p className="text-sm text-muted-foreground mb-3">Alle Standorte (bemaßt + original) in einer ZIP-Datei</p>
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
            <p className="text-sm text-muted-foreground">Standorte einzeln herunterladen</p>
            {sortedLocations.map((location) => (
              <div key={location.id} className="border rounded-lg p-3 space-y-2">
                <div className="font-medium text-sm">Standort {location.locationNumber}{location.locationName && <span className="text-muted-foreground font-normal ml-2">{location.locationName}</span>}</div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="flex-1" disabled={downloadingImages[`${location.id}-annotated`]} onClick={() => handleDownloadImage(location.id, location.imageData, `${project.projectNumber}_${location.locationNumber}_bemasst.png`, 'annotated')}>
                    {downloadingImages[`${location.id}-annotated`] ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <FileImage className="h-3 w-3 mr-1" />} Bemaßt
                  </Button>
                  <Button size="sm" variant="outline" className="flex-1" disabled={downloadingImages[`${location.id}-original`]} onClick={() => handleDownloadImage(location.id, location.originalImageData, `${project.projectNumber}_${location.locationNumber}_original.png`, 'original')}>
                    {downloadingImages[`${location.id}-original`] ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <FileImage className="h-3 w-3 mr-1" />} Original
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};


function projectNeedsHydration(project: Project | null): boolean {
  if (!project) return true;
  if (!Array.isArray(project.locations) || project.locations.length === 0) return true;

  const hasRenderableLocationContent = project.locations.some((location) => {
    const hasImage = !!location.imageData || !!location.originalImageData;
    const hasDetails = Array.isArray(location.detailImages) && location.detailImages.length > 0;
    const hasFields = !!(location.locationName || location.comment || location.system || location.label || location.locationType);
    const hasCustomFields = !!(location.customFields && Object.keys(location.customFields).length > 0);
    const hasAreaMeasurements = !!(location.areaMeasurements && location.areaMeasurements.length > 0);
    return hasImage || hasDetails || hasFields || hasCustomFields || hasAreaMeasurements;
  });

  return !hasRenderableLocationContent;
}

function naturalLocationSort(a: string, b: string) {
  return a.localeCompare(b, "de", { numeric: true, sensitivity: "base" });
}

function shortLocationNumber(locationNumber: string) {
  const parts = locationNumber.split("-");
  return parts[parts.length - 1] || locationNumber;
}

function drawSectionCard(pdf: jsPDF, title: string, rows: { label: string; value: string }[], startY: number) {
  if (!rows.length) return startY;
  const left = MARGIN;
  const width = CONTENT_WIDTH;
  const colWidth = (width - 8) / 2;
  let cursorY = startY;

  const measuredRows = rows.map((row) => {
    const valueLines = pdf.splitTextToSize(row.value, colWidth - 8);
    return { ...row, valueLines, height: 10 + valueLines.length * 4 };
  });

  const rowPairs: typeof measuredRows[] = [];
  for (let i = 0; i < measuredRows.length; i += 2) rowPairs.push(measuredRows.slice(i, i + 2));
  const bodyHeight = rowPairs.reduce((sum, pair) => sum + Math.max(...pair.map((item) => item.height)) + 3, 0);
  const totalHeight = 12 + bodyHeight + 2;

  pdf.setFillColor(248, 250, 252);
  pdf.roundedRect(left, cursorY, width, totalHeight, 2, 2, "F");
  pdf.setDrawColor(226, 232, 240);
  pdf.setLineWidth(0.3);
  pdf.roundedRect(left, cursorY, width, totalHeight, 2, 2, "S");

  pdf.setFontSize(9);
  pdf.setFont("helvetica", "bold");
  pdf.setTextColor(TEXT_MUTED.r, TEXT_MUTED.g, TEXT_MUTED.b);
  pdf.text(title.toUpperCase(), left + 4, cursorY + 7);
  cursorY += 11;

  for (const pair of rowPairs) {
    const pairHeight = Math.max(...pair.map((item) => item.height));
    pair.forEach((item, idx) => {
      const x = left + 4 + idx * (colWidth + 8);
      pdf.setFontSize(8);
      pdf.setFont("helvetica", "bold");
      pdf.setTextColor(TEXT_MUTED.r, TEXT_MUTED.g, TEXT_MUTED.b);
      pdf.text(item.label, x, cursorY + 3);
      pdf.setFontSize(10);
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(TEXT_PRIMARY.r, TEXT_PRIMARY.g, TEXT_PRIMARY.b);
      pdf.text(item.valueLines, x, cursorY + 8);
    });
    cursorY += pairHeight + 3;
  }

  return startY + totalHeight + 5;
}

function drawFeedbackCard(pdf: jsPDF, feedbacks: FeedbackItem[], startY: number) {
  if (!feedbacks.length) return startY;
  const left = MARGIN;
  const width = CONTENT_WIDTH;
  let y = startY;
  const rows = feedbacks.map((entry) => {
    const messageLines = pdf.splitTextToSize(entry.message, width - 16);
    return { entry, messageLines, height: 15 + messageLines.length * 4 };
  });
  const totalHeight = 12 + rows.reduce((sum, row) => sum + row.height + 3, 0);

  pdf.setFillColor(248, 250, 252);
  pdf.roundedRect(left, y, width, totalHeight, 2, 2, "F");
  pdf.setDrawColor(226, 232, 240);
  pdf.setLineWidth(0.3);
  pdf.roundedRect(left, y, width, totalHeight, 2, 2, "S");

  pdf.setFontSize(9);
  pdf.setFont("helvetica", "bold");
  pdf.setTextColor(TEXT_MUTED.r, TEXT_MUTED.g, TEXT_MUTED.b);
  pdf.text("KUNDEN-FEEDBACK", left + 4, y + 7);
  y += 11;

  rows.forEach(({ entry, messageLines, height }) => {
    pdf.setFillColor(255, 255, 255);
    pdf.roundedRect(left + 4, y, width - 8, height, 1.5, 1.5, "F");
    pdf.setDrawColor(226, 232, 240);
    pdf.roundedRect(left + 4, y, width - 8, height, 1.5, 1.5, "S");

    pdf.setFontSize(9);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(TEXT_PRIMARY.r, TEXT_PRIMARY.g, TEXT_PRIMARY.b);
    pdf.text(entry.author_name, left + 8, y + 5);

    pdf.setFontSize(8);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(TEXT_MUTED.r, TEXT_MUTED.g, TEXT_MUTED.b);
    const statusText = entry.status === "done" ? "Umgesetzt" : "Offen";
    pdf.text(`${new Date(entry.created_at).toLocaleDateString("de-DE")} · ${statusText}`, left + width - 8, y + 5, { align: "right" });

    pdf.setFontSize(9);
    pdf.setTextColor(TEXT_PRIMARY.r, TEXT_PRIMARY.g, TEXT_PRIMARY.b);
    pdf.text(messageLines, left + 8, y + 11);
    y += height + 3;
  });
  return startY + totalHeight + 5;
}

function drawAreaMeasurementsCard(pdf: jsPDF, areaMeasurements: any[], startY: number) {
  if (!areaMeasurements?.length) return startY;
  const rows = areaMeasurements.map((am) => ({
    label: `Fläche ${am.index}`,
    value: `${am.widthMm} × ${am.heightMm} mm · ${((am.widthMm * am.heightMm) / 1_000_000).toFixed(2)} m²`,
  }));
  const total = areaMeasurements.reduce((sum, am) => sum + (am.widthMm * am.heightMm) / 1_000_000, 0);
  rows.push({ label: "Gesamt", value: `${total.toFixed(2)} m²` });
  return drawSectionCard(pdf, "Flächen", rows, startY);
}

async function drawLocationPage({ pdf, project, location, visibleFields, customerOnly, feedbacks, dateStr, currentPage, totalPages, floorPlanPageMap, sortedFloorPlans, resolveFieldValue }: any) {
  drawPageHeader(pdf, project.projectNumber);
  drawPageFooter(pdf, dateStr, currentPage, totalPages);
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
  const imageMaxH = 95;
  const imageRatio = Math.min(CONTENT_WIDTH / imgDims.width, imageMaxH / imgDims.height);
  const imageW = imgDims.width * imageRatio;
  const imageH = imgDims.height * imageRatio;
  const imageX = MARGIN + (CONTENT_WIDTH - imageW) / 2;
  drawImageWithBorder(pdf, location.imageData, imageX, y, imageW, imageH);
  y += imageH + 6;

  const rows = visibleFields
    .map((field: any) => {
      const value = resolveFieldValue(location, field.field_key);
      if (value === undefined || value === null || value === "") return null;
      const displayValue = field.field_type === "checkbox" ? ((value === true || value === "true") ? "Ja" : "Nein") : String(value);
      return { label: field.field_label, value: displayValue };
    })
    .filter(Boolean);
  y = drawSectionCard(pdf, customerOnly ? "Sichtbare Standortinfos" : "Standortinfos", rows as any, y);

  y = drawAreaMeasurementsCard(pdf, location.areaMeasurements || [], y);
  y = drawFeedbackCard(pdf, feedbacks, y);
}

async function drawDetailImagesPage({ pdf, projectNumber, location, dateStr, currentPage, totalPages }: any) {
  drawPageHeader(pdf, projectNumber);
  drawPageFooter(pdf, dateStr, currentPage, totalPages);
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
    if (y + h + 14 > PAGE_HEIGHT - MARGIN) {
      pdf.addPage();
      drawPageHeader(pdf, projectNumber);
      y = MARGIN + 16;
      col = 0;
    }
    drawImageWithBorder(pdf, detail.imageData, x, y, w, h);
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
