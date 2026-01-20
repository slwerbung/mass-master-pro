/**
 * iOS/iPad-compatible export utilities
 * Handles downloads reliably across Safari, Firefox, and Chrome on all devices
 */

/**
 * Detect iOS/iPadOS devices
 */
export const isIOSDevice = (): boolean => {
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua);
  const isIPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return isIOS || isIPadOS;
};

/**
 * Detect Safari browser
 */
export const isSafari = (): boolean => {
  const ua = navigator.userAgent;
  return /^((?!chrome|android).)*safari/i.test(ua);
};

/**
 * Convert data URI to Blob for reliable downloads
 */
export const dataURItoBlob = (dataURI: string): Blob => {
  // Handle both data URI formats
  const parts = dataURI.split(',');
  const meta = parts[0];
  const base64Data = parts[1];
  
  if (!base64Data) {
    throw new Error('Invalid data URI format');
  }

  // Extract MIME type
  const mimeMatch = meta.match(/:(.*?);/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'application/octet-stream';

  // Decode base64
  const byteString = atob(base64Data);
  const arrayBuffer = new ArrayBuffer(byteString.length);
  const uint8Array = new Uint8Array(arrayBuffer);

  for (let i = 0; i < byteString.length; i++) {
    uint8Array[i] = byteString.charCodeAt(i);
  }

  return new Blob([uint8Array], { type: mimeType });
};

/**
 * Download a blob as a file - iOS compatible
 */
export const downloadBlob = async (blob: Blob, filename: string): Promise<boolean> => {
  try {
    // Create object URL
    const url = URL.createObjectURL(blob);

    // Create anchor element
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    
    // For iOS Safari, we need special handling
    if (isIOSDevice() && isSafari()) {
      // Try to use the Web Share API if available
      if (navigator.share && navigator.canShare) {
        const file = new File([blob], filename, { type: blob.type });
        const shareData = { files: [file] };
        
        if (navigator.canShare(shareData)) {
          try {
            await navigator.share(shareData);
            URL.revokeObjectURL(url);
            return true;
          } catch (shareError) {
            // User cancelled or share failed, fall through to download
            console.log('Share cancelled, trying download');
          }
        }
      }
      
      // Fallback: Open in new tab for iOS Safari
      // User can long-press to save
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    }

    // Append, click, and remove
    document.body.appendChild(link);
    link.click();
    
    // Clean up after a short delay
    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 100);

    return true;
  } catch (error) {
    console.error('Download failed:', error);
    return false;
  }
};

/**
 * Download image from data URI
 */
export const downloadImage = async (
  dataURI: string, 
  filename: string
): Promise<boolean> => {
  try {
    const blob = dataURItoBlob(dataURI);
    return await downloadBlob(blob, filename);
  } catch (error) {
    console.error('Image download failed:', error);
    return false;
  }
};

/**
 * Download PDF blob
 */
export const downloadPDF = async (
  pdfBlob: Blob, 
  filename: string
): Promise<boolean> => {
  return await downloadBlob(pdfBlob, filename);
};
