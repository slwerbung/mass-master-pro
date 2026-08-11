// PDF-Dokument für den internen Probo-Produktkatalog.
//
// Gebaut mit @react-pdf/renderer, weil CaptFix keinen Node-Server hat, auf
// dem ein Headless-Chrome laufen könnte – das PDF entsteht komplett im
// Browser. Layout-Freiheit ist dadurch eingeschränkt (Flexbox-Subset,
// Fonts nur über Font.register), reicht für einen Katalog aber aus.

import { Document, Page, Text, View, Image, StyleSheet, Font } from "@react-pdf/renderer";

export interface CatalogProduct {
  code: string;
  name: string;
  description: string;
  properties: { label: string; value: string }[];
  /** Data-URL (JPEG/PNG) – kommt über den Bild-Proxy der Edge Function. */
  imageDataUrl?: string | null;
  /** Freitext aus den Overrides, z. B. "ab 39 €/m²" oder "auf Anfrage". */
  price?: string;
}

export interface CatalogBranding {
  primary: string;
  accent: string;
}

export interface CatalogDocumentProps {
  customerName: string;
  customerLogoDataUrl?: string | null;
  introTitle: string;
  introText: string;
  branding: CatalogBranding;
  products: CatalogProduct[];
}

// Barlow liegt bereits im Repo (public/fonts) und wird auch sonst in der App
// verwendet. Same-Origin, also ohne CORS-Probleme ladbar.
Font.register({
  family: "Barlow",
  fonts: [
    { src: "/fonts/Barlow-Regular.ttf", fontWeight: 400 },
    { src: "/fonts/Barlow-Bold.ttf", fontWeight: 700 },
  ],
});

// Ohne das trennt react-pdf lange Wörter (Produktcodes) an unschönen Stellen.
Font.registerHyphenationCallback((word) => [word]);

const COMPANY = {
  name: "SL Werbung",
  email: "info@slwerbung.de",
  web: "www.slwerbung.de",
};

const styles = StyleSheet.create({
  page: {
    fontFamily: "Barlow",
    fontSize: 11,
    color: "#1f2937",
    paddingTop: 40,
    paddingBottom: 60,
    paddingHorizontal: 44,
  },
  coverPage: {
    fontFamily: "Barlow",
    color: "#1f2937",
    paddingBottom: 60,
  },
  coverBand: {
    height: 220,
    paddingHorizontal: 44,
    paddingTop: 48,
    justifyContent: "flex-start",
  },
  coverBrand: {
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: 2,
    color: "#ffffff",
    textTransform: "uppercase",
  },
  coverTitle: {
    marginTop: 18,
    fontSize: 34,
    fontWeight: 700,
    color: "#ffffff",
  },
  coverSubtitle: {
    marginTop: 8,
    fontSize: 14,
    color: "#ffffff",
    opacity: 0.9,
  },
  coverBody: {
    paddingHorizontal: 44,
    paddingTop: 32,
  },
  coverLogo: {
    maxHeight: 70,
    maxWidth: 200,
    marginBottom: 24,
    objectFit: "contain",
  },
  coverCustomerLabel: {
    fontSize: 10,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: "#6b7280",
  },
  coverCustomerName: {
    fontSize: 20,
    fontWeight: 700,
    marginTop: 4,
  },
  introTitle: {
    marginTop: 28,
    fontSize: 16,
    fontWeight: 700,
  },
  introText: {
    marginTop: 8,
    fontSize: 11,
    lineHeight: 1.6,
    color: "#374151",
  },
  coverMeta: {
    marginTop: 32,
    fontSize: 10,
    color: "#6b7280",
  },
  productHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    borderBottomWidth: 2,
    paddingBottom: 8,
    marginBottom: 18,
  },
  productName: {
    fontSize: 20,
    fontWeight: 700,
    flexGrow: 1,
    flexShrink: 1,
    paddingRight: 12,
  },
  productCode: {
    fontSize: 9,
    color: "#6b7280",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  imageBox: {
    height: 260,
    backgroundColor: "#f3f4f6",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
  },
  productImage: {
    height: 260,
    objectFit: "contain",
  },
  imagePlaceholder: {
    fontSize: 10,
    color: "#9ca3af",
  },
  description: {
    fontSize: 11,
    lineHeight: 1.6,
    color: "#374151",
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: "#6b7280",
    marginBottom: 8,
  },
  propertyRow: {
    flexDirection: "row",
    paddingVertical: 5,
    borderBottomWidth: 0.5,
    borderBottomColor: "#e5e7eb",
  },
  propertyLabel: {
    width: "38%",
    fontWeight: 700,
    fontSize: 10,
    paddingRight: 8,
  },
  propertyValue: {
    width: "62%",
    fontSize: 10,
    color: "#374151",
  },
  priceBox: {
    marginTop: 20,
    padding: 12,
    backgroundColor: "#f9fafb",
    borderLeftWidth: 3,
  },
  priceLabel: {
    fontSize: 9,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: "#6b7280",
  },
  priceValue: {
    fontSize: 14,
    fontWeight: 700,
    marginTop: 3,
  },
  footer: {
    position: "absolute",
    bottom: 26,
    left: 44,
    right: 44,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 0.5,
    borderTopColor: "#e5e7eb",
    paddingTop: 8,
    fontSize: 8,
    color: "#6b7280",
  },
});

const Footer = () => (
  <View style={styles.footer} fixed>
    <Text>
      {COMPANY.name} · {COMPANY.email} · {COMPANY.web}
    </Text>
    <Text render={({ pageNumber, totalPages }) => `Seite ${pageNumber} von ${totalPages}`} />
  </View>
);

const CatalogDocument = ({
  customerName,
  customerLogoDataUrl,
  introTitle,
  introText,
  branding,
  products,
}: CatalogDocumentProps) => {
  const dateLabel = new Date().toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  return (
    <Document title={`Produktkatalog${customerName ? ` – ${customerName}` : ""}`} author={COMPANY.name}>
      {/* Deckblatt */}
      <Page size="A4" style={styles.coverPage}>
        <View style={[styles.coverBand, { backgroundColor: branding.primary }]}>
          <Text style={styles.coverBrand}>{COMPANY.name}</Text>
          <Text style={styles.coverTitle}>{introTitle || "Produktkatalog"}</Text>
          <Text style={styles.coverSubtitle}>Eine Auswahl für Ihr Projekt</Text>
        </View>

        <View style={styles.coverBody}>
          {customerLogoDataUrl ? <Image src={customerLogoDataUrl} style={styles.coverLogo} /> : null}

          {customerName ? (
            <>
              <Text style={styles.coverCustomerLabel}>Zusammengestellt für</Text>
              <Text style={[styles.coverCustomerName, { color: branding.primary }]}>{customerName}</Text>
            </>
          ) : null}

          {introText ? (
            <>
              <Text style={styles.introTitle}>Zu dieser Auswahl</Text>
              <Text style={styles.introText}>{introText}</Text>
            </>
          ) : null}

          <Text style={styles.coverMeta}>
            {products.length} {products.length === 1 ? "Produkt" : "Produkte"} · Stand {dateLabel}
          </Text>
        </View>

        <Footer />
      </Page>

      {/* Je Produkt eine Seite */}
      {products.map((product) => (
        <Page size="A4" style={styles.page} key={product.code}>
          <View style={[styles.productHeader, { borderBottomColor: branding.primary }]}>
            <Text style={styles.productName}>{product.name || product.code}</Text>
            <Text style={styles.productCode}>{product.code}</Text>
          </View>

          <View style={styles.imageBox}>
            {product.imageDataUrl ? (
              <Image src={product.imageDataUrl} style={styles.productImage} />
            ) : (
              <Text style={styles.imagePlaceholder}>Kein Produktbild verfügbar</Text>
            )}
          </View>

          {product.description ? <Text style={styles.description}>{product.description}</Text> : null}

          {product.properties.length ? (
            <View>
              <Text style={styles.sectionTitle}>Eigenschaften</Text>
              {product.properties.map((property) => (
                <View style={styles.propertyRow} key={property.label}>
                  <Text style={styles.propertyLabel}>{property.label}</Text>
                  <Text style={styles.propertyValue}>{property.value}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {product.price ? (
            <View style={[styles.priceBox, { borderLeftColor: branding.accent }]}>
              <Text style={styles.priceLabel}>Richtpreis</Text>
              <Text style={[styles.priceValue, { color: branding.primary }]}>{product.price}</Text>
            </View>
          ) : null}

          <Footer />
        </Page>
      ))}
    </Document>
  );
};

export default CatalogDocument;
