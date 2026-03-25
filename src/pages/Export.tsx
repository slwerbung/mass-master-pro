import { useEffect, useState } from "react";
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
  isIOSDevice 
} from "@/lib/exportUtils";
import PDFExportOptionsUI, { PDFExportOptions, defaultPDFOptions } from "@/components/PDFExportOptions";
import {
  getImageDimensions,
  drawPageHeader,
  drawPageFooter,
  drawCoverPage,
  drawMetadataBox,
  drawImageWithBorder,
  drawCommentBlock,
  drawBackLink,
  MARGIN,
  CONTENT_WIDTH,
  PAGE_HEIGHT,
  BLUE,
  TEXT_PRIMARY,
  TEXT_MUTED,
} from "@/lib/pdfHelpers";


const Export = () => {
  const { projectId } = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [downloadingPDF, setDownloadingPDF] = useState(false);
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [downloadingImages, setDownloadingImages] = useState<Record<string, boolean>>({});
  const [pdfOptions, setPdfOptions] = useState<PDFExportOptions>(defaultPDFOptions);
  const navigate = useNavigate();

  useEffect(() => {
    const loadProject = async () => {
      if (projectId) {
        try {
          const loadedProject = await indexedDBStorage.getProject(projectId);
          if (loadedProject) {
            setProject(loadedProject);
          } else {
            toast.error("Projekt nicht gefunden");
            navigate("/");
          }
        } catch (error) {
          console.error("Error loading project:", error);
          toast.error("Fehler beim Laden des Projekts");
          navigate("/");
        } finally {
          setIsLoading(false);
        }
      }
    };
    loadProject();
  }, [projectId, navigate]);

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
      
      for (const location of project.locations) {
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
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });

      const maxContentHeight = PAGE_HEIGHT - 2 * MARGIN;
      const headerOffset = 16; // space below header line

      // --- Page counting for internal links ---
      const locationPageMap: Record<string, number> = {};
      const floorPlanPageMap: Record<string, number> = {};
      let pageCounter = 2; // page 1 = cover

      if (project.projectType === 'aufmass_mit_plan' && project.floorPlans && project.floorPlans.length > 0) {
        for (const fp of project.floorPlans) {
          floorPlanPageMap[fp.id] = pageCounter++;
        }
      }
      for (const location of project.locations) {
        locationPageMap[location.id] = pageCounter++;
        if (pdfOptions.includeDetailImages && location.detailImages && location.detailImages.length > 0) {
          pageCounter++;
        }
      }
      const totalPages = pageCounter - 1;

      const dateStr = new Date().toLocaleDateString("de-DE");

      // ===== COVER PAGE =====
      drawCoverPage(pdf, project.projectNumber, project.locations.length, project.projectType);
      drawPageFooter(pdf, dateStr, 1, totalPages);

      // ===== FLOOR PLAN PAGES =====
      if (project.projectType === 'aufmass_mit_plan' && project.floorPlans && project.floorPlans.length > 0) {
        for (const floorPlan of project.floorPlans) {
          pdf.addPage();
          const currentPage = floorPlanPageMap[floorPlan.id];
          drawPageHeader(pdf, project.projectNumber);
          drawPageFooter(pdf, dateStr, currentPage, totalPages);

          let y = MARGIN + headerOffset;

          pdf.setFontSize(14);
          pdf.setFont("helvetica", "bold");
          pdf.setTextColor(TEXT_PRIMARY.r, TEXT_PRIMARY.g, TEXT_PRIMARY.b);
          pdf.text(`Grundriss: ${floorPlan.name}`, MARGIN, y);
          y += 8;

          const fpDims = await getImageDimensions(floorPlan.imageData);
          const fpMaxH = PAGE_HEIGHT - y - MARGIN - 20;
          const fpRatio = Math.min(CONTENT_WIDTH / fpDims.width, fpMaxH / fpDims.height);
          const fpW = fpDims.width * fpRatio;
          const fpH = fpDims.height * fpRatio;
          const fpX = MARGIN + (CONTENT_WIDTH - fpW) / 2;

          drawImageWithBorder(pdf, floorPlan.imageData, fpX, y, fpW, fpH);

          // Draw markers
          for (const marker of floorPlan.markers) {
            const loc = project.locations.find(l => l.id === marker.locationId);
            if (!loc) continue;
            const mx = fpX + marker.x * fpW;
            const my = y + marker.y * fpH;
            const parts = loc.locationNumber.split("-");
            const shortNum = parts[parts.length - 1] || loc.locationNumber;

            const targetPage = locationPageMap[loc.id];
            if (targetPage) {
              pdf.link(mx - 4, my - 4, 8, 8, { pageNumber: targetPage });
            }

            pdf.setFillColor(BLUE.r, BLUE.g, BLUE.b);
            pdf.circle(mx, my, 2.5, 'F');
            pdf.setFontSize(6);
            pdf.setFont("helvetica", "bold");
            pdf.setTextColor(255, 255, 255);
            pdf.text(shortNum, mx, my + 0.8, { align: "center" });
          }
        }
      }

      // ===== LOCATION PAGES =====
      for (const location of project.locations) {
        pdf.addPage();
        const currentPage = locationPageMap[location.id];
        drawPageHeader(pdf, project.projectNumber);
        drawPageFooter(pdf, dateStr, currentPage, totalPages);

        let y = MARGIN + headerOffset;

        // Back link to floor plan
        if (project.projectType === 'aufmass_mit_plan' && project.floorPlans && project.floorPlans.length > 0) {
          const parentFloorPlan = project.floorPlans.find(fp =>
            fp.markers.some(m => m.locationId === location.id)
          );
          if (parentFloorPlan) {
            const fpPage = floorPlanPageMap[parentFloorPlan.id];
            if (fpPage) {
              y = drawBackLink(pdf, `← Grundriss: ${parentFloorPlan.name}`, y, fpPage);
            }
          }
        }

        // Location title
        if (pdfOptions.includeLocationNumber) {
          pdf.setFontSize(16);
          pdf.setFont("helvetica", "bold");
          pdf.setTextColor(TEXT_PRIMARY.r, TEXT_PRIMARY.g, TEXT_PRIMARY.b);
          const title = location.locationName
            ? `Standort ${location.locationNumber} — ${location.locationName}`
            : `Standort ${location.locationNumber}`;
          pdf.text(title, MARGIN, y + 2);
          y += 10;
        }

        // Metadata box
        const metaRows: { label: string; value: string }[] = [];
        if (pdfOptions.includeSystem && location.system) {
          metaRows.push({ label: "System", value: location.system });
        }
        if (pdfOptions.includeLocationType && location.locationType) {
          metaRows.push({ label: "Art", value: location.locationType });
        }
        if (pdfOptions.includeLabel && location.label) {
          metaRows.push({ label: "Beschriftung", value: location.label });
        }
        if (pdfOptions.includeCreatedDate) {
          metaRows.push({ label: "Erstellt", value: new Date(location.createdAt).toLocaleDateString("de-DE") });
        }

        if (metaRows.length > 0) {
          y = drawMetadataBox(pdf, metaRows, y);
        }

        // Calculate available space for images
        let bottomContentHeight = 0;
        if (pdfOptions.includeComment && location.comment) {
          bottomContentHeight += 20;
        }

        const usedHeight = y - MARGIN;
        const availableForImages = maxContentHeight - usedHeight - bottomContentHeight - 5;

        const showAnnotated = pdfOptions.includeAnnotatedImage;
        const showOriginal = pdfOptions.includeOriginalImage;
        const imageCount = (showAnnotated ? 1 : 0) + (showOriginal ? 1 : 0);

        if (imageCount > 0) {
          const maxHeightPerImage = imageCount === 2
            ? (availableForImages - 5) / 2
            : availableForImages;

          y += 3;

          const addImage = async (dataURI: string) => {
            const dims = await getImageDimensions(dataURI);
            const ratio = Math.min(CONTENT_WIDTH / dims.width, maxHeightPerImage / dims.height);
            const w = dims.width * ratio;
            const h = dims.height * ratio;
            const x = MARGIN + (CONTENT_WIDTH - w) / 2;
            drawImageWithBorder(pdf, dataURI, x, y, w, h);
            y += h + 5;
          };

          if (showAnnotated) await addImage(location.imageData);
          if (showOriginal) await addImage(location.originalImageData);
        }

        // Comment block
        if (pdfOptions.includeComment && location.comment) {
          y = drawCommentBlock(pdf, location.comment, y);
        }

        // Detail images on follow-up pages
        if (pdfOptions.includeDetailImages && location.detailImages && location.detailImages.length > 0) {
          pdf.addPage();
          drawPageHeader(pdf, project.projectNumber);
          let dy = MARGIN + headerOffset;

          pdf.setFontSize(11);
          pdf.setFont("helvetica", "bold");
          pdf.setTextColor(TEXT_PRIMARY.r, TEXT_PRIMARY.g, TEXT_PRIMARY.b);
          pdf.text(`Detailbilder – Standort ${location.locationNumber}`, MARGIN, dy);
          dy += 10;

          for (const detail of location.detailImages) {
            const dims = await getImageDimensions(detail.imageData);
            const maxH = 80;
            const ratio = Math.min(CONTENT_WIDTH / dims.width, maxH / dims.height);
            const w = dims.width * ratio;
            const h = dims.height * ratio;

            if (dy + h + 10 > PAGE_HEIGHT - MARGIN) {
              pdf.addPage();
              drawPageHeader(pdf, project.projectNumber);
              dy = MARGIN + headerOffset;
            }

            const x = MARGIN + (CONTENT_WIDTH - w) / 2;
            drawImageWithBorder(pdf, detail.imageData, x, dy, w, h);
            dy += h + 2;

            if (detail.caption) {
              pdf.setFontSize(8);
              pdf.setFont("helvetica", "italic");
              pdf.setTextColor(TEXT_MUTED.r, TEXT_MUTED.g, TEXT_MUTED.b);
              pdf.text(detail.caption, MARGIN, dy + 3);
              dy += 7;
            }
            dy += 3;
          }
        }
      }

      const pdfBlob = pdf.output("blob");
      const success = await downloadBlob(
        pdfBlob, 
        `Aufmass_${project.projectNumber}.pdf`
      );
      
      if (success) {
        toast.success("PDF wird heruntergeladen");
      } else {
        toast.error("PDF-Download fehlgeschlagen");
      }
    } catch (error) {
      console.error("PDF export error:", error);
      toast.error("Fehler beim PDF-Export");
    } finally {
      setDownloadingPDF(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Laden...</div>
      </div>
    );
  }

  if (!project) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-2xl mx-auto p-4 space-y-6">
        <Button
          variant="ghost"
          onClick={() => navigate(`/projects/${projectId}`)}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Zurück
        </Button>

        <div>
          <h1 className="text-3xl font-bold">Export</h1>
          <p className="text-muted-foreground mt-1">
            Projekt {project.projectNumber} exportieren
          </p>
        </div>

        {/* PDF Export */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-primary" />
              PDF-Dokument
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-3">
              Alle Standorte in einem zusammengefassten PDF-Dokument
            </p>
            <PDFExportOptionsUI options={pdfOptions} onChange={setPdfOptions} />
            <Button 
              onClick={exportAsPDF} 
              disabled={downloadingPDF}
              className="w-full"
            >
              {downloadingPDF ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              PDF herunterladen
            </Button>
          </CardContent>
        </Card>

        {/* ZIP Export */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-3">
              <Archive className="h-5 w-5 text-primary" />
              Alle Bilder als ZIP
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-3">
              Alle Standorte (bemaßt + original) in einer ZIP-Datei
            </p>
            <Button 
              onClick={exportAsZip} 
              disabled={downloadingZip}
              variant="secondary"
              className="w-full"
            >
              {downloadingZip ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              ZIP herunterladen
            </Button>
          </CardContent>
        </Card>

        {/* Individual Images */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-3">
              <FileImage className="h-5 w-5 text-primary" />
              Einzelne Bilder
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Standorte einzeln herunterladen
            </p>
            
            {project.locations.map((location) => (
              <div 
                key={location.id} 
                className="border rounded-lg p-3 space-y-2"
              >
                <div className="font-medium text-sm">
                  Standort {location.locationNumber}
                  {location.locationName && (
                    <span className="text-muted-foreground font-normal ml-2">
                      {location.locationName}
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    disabled={downloadingImages[`${location.id}-annotated`]}
                    onClick={() => handleDownloadImage(
                      location.id,
                      location.imageData,
                      `${project.projectNumber}_${location.locationNumber}_bemasst.png`,
                      'annotated'
                    )}
                  >
                    {downloadingImages[`${location.id}-annotated`] ? (
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    ) : (
                      <FileImage className="h-3 w-3 mr-1" />
                    )}
                    Bemaßt
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    disabled={downloadingImages[`${location.id}-original`]}
                    onClick={() => handleDownloadImage(
                      location.id,
                      location.originalImageData,
                      `${project.projectNumber}_${location.locationNumber}_original.png`,
                      'original'
                    )}
                  >
                    {downloadingImages[`${location.id}-original`] ? (
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    ) : (
                      <FileImage className="h-3 w-3 mr-1" />
                    )}
                    Original
                  </Button>
                </div>
              </div>
            ))}

            {isIOSDevice() && (
              <p className="text-xs text-muted-foreground text-center pt-2 border-t">
                💡 Tipp: Auf iPad/iPhone ggf. lange auf das Bild drücken → "In Fotos speichern"
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Export;
