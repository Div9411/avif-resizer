import React, { useState, useRef, useEffect, useCallback } from "react";
import { encode } from "@jsquash/avif";
import "./App.css";

function App() {
  // --- State for multiple files ---
  const [inputFiles, setInputFiles] = useState([]); // Array of File objects
  const [originalDimensionsList, setOriginalDimensionsList] = useState([]); // Array of {width, height}
  const [imageUrlList, setImageUrlList] = useState([]); // Array of preview URLs
  const [loadedImages, setLoadedImages] = useState([]); // Array of loaded Image objects
  // --- State for single file or batch settings ---
  const [targetWidth, setTargetWidth] = useState("");
  const [targetHeight, setTargetHeight] = useState("");
  const [quality, setQuality] = useState(75); // Default quality percentage
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState("");

  const outputCanvasRef = useRef(null);

  // Clean up ObjectURLs for previews
  useEffect(() => {
    return () => {
      imageUrlList.forEach((url) => {
        if (url && url.startsWith("blob:")) {
          URL.revokeObjectURL(url);
        }
      });
    };
  }, [imageUrlList]); // Depend on the list

  const handleFileChange = (event) => {
    const files = event.target.files; // FileList
    setError("");
    setTargetWidth(""); // Reset target dims
    setTargetHeight("");
    // Reset all lists
    setInputFiles([]);
    setOriginalDimensionsList([]);
    setImageUrlList([]);
    setLoadedImages([]);

    // --- Cleanup previous preview URLs ---
    imageUrlList.forEach((url) => {
      if (url && url.startsWith("blob:")) {
        URL.revokeObjectURL(url);
      }
    });

    if (!files || files.length === 0) {
      // Reset file input value if selection was cancelled
      event.target.value = null;
      return; // Nothing selected
    }

    const validImageFiles = Array.from(files).filter((file) =>
      file.type.startsWith("image/")
    );

    if (validImageFiles.length === 0) {
      setError(
        "No valid image files selected. Please select PNG, JPG, GIF, WEBP, etc."
      );
      event.target.value = null; // Reset input
      return;
    }

    setInputFiles(validImageFiles); // Store the valid files

    // Process each file
    const promises = validImageFiles.map((file) => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const dataUrl = e.target.result;
          const img = new Image();
          img.onload = () => {
            resolve({
              img,
              dimensions: {
                width: img.naturalWidth,
                height: img.naturalHeight,
              },
              url: dataUrl, // Use Data URL for preview consistency initially
              file: file, // Keep track of the original file for filename later
            });
          };
          img.onerror = () => {
            console.error("Failed to load image:", file.name);
            // Resolve with null to indicate failure for this specific image
            resolve(null);
          };
          img.src = dataUrl;
        };
        reader.onerror = () => {
          console.error("Failed to read file:", file.name);
          // Resolve with null to indicate failure for this specific image
          resolve(null);
        };
        reader.readAsDataURL(file);
      });
    });

    // Wait for all files to be processed
    Promise.all(promises).then((results) => {
      const successfulResults = results.filter((r) => r !== null);

      if (successfulResults.length === 0 && validImageFiles.length > 0) {
        setError(
          "Failed to load any of the selected images. They might be corrupt or unsupported."
        );
      } else if (successfulResults.length < validImageFiles.length) {
        setError(
          `Warning: Failed to load ${
            validImageFiles.length - successfulResults.length
          } image(s). Processing the rest.`
        );
      }

      // Update state with successfully loaded images
      setLoadedImages(successfulResults.map((r) => r.img));
      setOriginalDimensionsList(successfulResults.map((r) => r.dimensions));
      setImageUrlList(successfulResults.map((r) => r.url));

      // **Crucially: If only ONE image was successfully loaded, set target dimensions**
      if (successfulResults.length === 1) {
        const { width, height } = successfulResults[0].dimensions;
        setTargetWidth(width.toString());
        setTargetHeight(height.toString());
      }

      // Keep the original valid files list (even if some failed to load img data)
      // This ensures the UI reflects the selection count correctly
      setInputFiles(successfulResults.map((r) => r.file));
    });

    // Reset file input value so selecting the same file(s) again triggers onChange
    event.target.value = null;
  };

  // Dimension change handlers remain the same, only used for single image mode
  const handleDimensionChange = (value, type) => {
    const numValue = value.replace(/\D/g, ""); // Allow only digits
    if (type === "width") {
      setTargetWidth(numValue);
    } else {
      setTargetHeight(numValue);
    }
  };

  // Ratio click handler remains the same, only used for single image mode
  const handleRatioClick = (divisor) => {
    // Ensure we're in single image mode
    if (inputFiles.length === 1 && originalDimensionsList.length === 1) {
      const originalDimensions = originalDimensionsList[0];
      const newWidth = Math.max(
        1,
        Math.round(originalDimensions.width / divisor)
      );
      const newHeight = Math.max(
        1,
        Math.round(originalDimensions.height / divisor)
      );
      setTargetWidth(newWidth.toString());
      setTargetHeight(newHeight.toString());
    }
  };

  const handleQualityChange = (event) => {
    setQuality(parseInt(event.target.value, 10));
  };

  // The specialized drawCanvas function for resizing WITH background blur
  // Only used when inputFiles.length === 1
  const drawResizedCanvasWithBackground = useCallback(
    (img, canvas, tWidth, tHeight) => {
      const ctx = canvas.getContext("2d");
      if (!ctx || !img) return null;

      // Ensure dimensions are positive integers
      tWidth = Math.max(1, Math.round(tWidth));
      tHeight = Math.max(1, Math.round(tHeight));

      const oWidth = img.naturalWidth;
      const oHeight = img.naturalHeight;

      canvas.width = tWidth;
      canvas.height = tHeight;
      ctx.clearRect(0, 0, tWidth, tHeight); // Clear canvas

      // --- Background Blur ---
      const coverScale = Math.max(tWidth / oWidth, tHeight / oHeight);
      const coverWidth = oWidth * coverScale;
      const coverHeight = oHeight * coverScale;
      const coverX = (tWidth - coverWidth) / 2;
      const coverY = (tHeight - coverHeight) / 2;

      ctx.filter = "blur(15px) brightness(0.9)";
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, coverX, coverY, coverWidth, coverHeight);
      // Optional: Draw canvas onto itself might help edge blur consistency
      // ctx.drawImage(canvas, 0, 0);

      ctx.filter = "none";
      ctx.imageSmoothingEnabled = false; // Usually false for crisp foreground

      // --- Foreground Centered Image ---
      const fitScale = Math.min(tWidth / oWidth, tHeight / oHeight);
      const scaledWidth = oWidth * fitScale;
      const scaledHeight = oHeight * fitScale;
      const x = (tWidth - scaledWidth) / 2;
      const y = (tHeight - scaledHeight) / 2;

      ctx.drawImage(img, x, y, scaledWidth, scaledHeight);

      return ctx;
    },
    []
  );

  const handleDownload = async () => {
    if (
      inputFiles.length === 0 ||
      loadedImages.length !== inputFiles.length || // Ensure all selected files are loaded as images
      !outputCanvasRef.current ||
      isProcessing
    ) {
      setError("Upload image(s) first, and wait for previews to load.");
      return;
    }

    const canvas = outputCanvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setError("Failed to get canvas context.");
      return;
    }

    const isSingleImageMode = inputFiles.length === 1;
    let currentTargetWidth = 0;
    let currentTargetHeight = 0;

    // Validate dimensions ONLY if in single image mode
    if (isSingleImageMode) {
      currentTargetWidth = parseInt(targetWidth, 10);
      currentTargetHeight = parseInt(targetHeight, 10);
      if (
        isNaN(currentTargetWidth) ||
        isNaN(currentTargetHeight) ||
        currentTargetWidth <= 0 ||
        currentTargetHeight <= 0
      ) {
        setError(
          "Invalid target dimensions. Width and height must be positive numbers."
        );
        return;
      }
    }

    setError("");
    setIsProcessing(true);

    // Map slider quality (0-100) to AVIF cqLevel (0-63, lower is better quality)
    const cqLevel = Math.max(
      0,
      Math.min(63, Math.round(63 - (quality / 100) * 53))
    ); // Clamp CQ level

    console.log(
      `Encoding AVIF with Quality: ${quality}% -> CQ Level: ${cqLevel}`
    );

    try {
      // Process each image sequentially to avoid overwhelming resources
      for (let i = 0; i < loadedImages.length; i++) {
        const img = loadedImages[i];
        const file = inputFiles[i]; // Get the original file for naming

        // Ensure the image object is ready (might be redundant due to load check above, but safe)
        if (!img.complete || img.naturalWidth === 0) {
          console.warn(
            `Image data for ${file.name} not fully available, skipping.`
          );
          continue; // Skip this image
        }

        let imageData;

        // --- Drawing Logic ---
        if (isSingleImageMode) {
          // Use the specialized resizing function for single images
          const drawCtx = drawResizedCanvasWithBackground(
            img,
            canvas,
            currentTargetWidth,
            currentTargetHeight
          );
          if (!drawCtx)
            throw new Error(`Failed to draw canvas for ${file.name}`);
          imageData = drawCtx.getImageData(0, 0, canvas.width, canvas.height);
        } else {
          // Batch mode: Use original dimensions, no resizing/padding effect
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          ctx.clearRect(0, 0, canvas.width, canvas.height); // Clear before drawing
          ctx.drawImage(img, 0, 0);
          imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        }

        // --- Encoding ---
        const avifBuffer = await encode(imageData, {
          cqLevel: cqLevel,
          speed: 6, // Balance speed and compression
        });

        if (!avifBuffer) {
          console.warn(
            `AVIF encoding returned empty buffer for ${file.name}, skipping.`
          );
          continue; // Skip this image
        }

        // --- Downloading ---
        const blob = new Blob([avifBuffer], { type: "image/avif" });
        const downloadUrl = URL.createObjectURL(blob);

        const link = document.createElement("a");
        link.href = downloadUrl;
        const originalFileName =
          file.name.substring(0, file.name.lastIndexOf(".")) || file.name;

        // Use target dimensions in filename only for single mode
        const dimensionsString = isSingleImageMode
          ? `${currentTargetWidth}x${currentTargetHeight}`
          : `${img.naturalWidth}x${img.naturalHeight}`;

        link.download = `${originalFileName}_${dimensionsString}_q${quality}.avif`;

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(downloadUrl); // Clean up immediately after click

        // Optional: Add a small delay between downloads for stability in some browsers
        await new Promise((resolve) => setTimeout(resolve, 100));
      } // End of loop
    } catch (err) {
      console.error("Processing or Download failed:", err);
      setError(
        `Error: ${
          err.message || "AVIF encoding/download failed. Check console."
        }`
      );
    } finally {
      setIsProcessing(false);
    }
  };

  // Determine if dimension controls should be shown
  const showDimensionControls =
    inputFiles.length === 1 && originalDimensionsList.length === 1;

  return (
    <div className="App">
      <h1>Any Image to AVIF Converter</h1>
      <p
        style={{
          color: "var(--text-muted-color)",
          marginTop: "-1.5rem",
          marginBottom: "2rem",
        }}
      >
        Upload one or multiple images (PNG, JPG, WEBP, etc.). Resize single
        images or batch compress multiple images.
      </p>

      <div className="control-section upload-section">
        <label htmlFor="file-upload" className="custom-file-upload">
          {inputFiles.length === 0
            ? "1. Upload Image(s)"
            : `Selected: ${inputFiles.length} image(s)`}
        </label>
        <input
          id="file-upload"
          type="file"
          onChange={handleFileChange}
          accept="image/png, image/jpeg, image/gif, image/webp, image/bmp"
          disabled={isProcessing}
          multiple // <-- Allow multiple file selection
        />
      </div>

      {error && <p className="error-message">{error}</p>}

      {/* Only show controls and preview when images are successfully loaded */}
      {inputFiles.length > 0 && (
        <div className="controls-and-preview">
          <div className="controls">
            <h2>
              {showDimensionControls ? "2. Adjust Settings" : "2. Set Quality"}
            </h2>

            {/* --- Dimension Controls: Only for single image --- */}
            {showDimensionControls && (
              <>
                <div className="dimension-info">
                  Original: {originalDimensionsList[0]?.width} x{" "}
                  {originalDimensionsList[0]?.height} px
                </div>

                <div className="dimension-inputs">
                  <label>
                    Target Width:
                    <input
                      type="number"
                      value={targetWidth}
                      onChange={(e) =>
                        handleDimensionChange(e.target.value, "width")
                      }
                      disabled={isProcessing}
                      min="1"
                      step="1"
                      placeholder="Width"
                    />{" "}
                    px
                  </label>
                  <label>
                    Target Height:
                    <input
                      type="number"
                      value={targetHeight}
                      onChange={(e) =>
                        handleDimensionChange(e.target.value, "height")
                      }
                      disabled={isProcessing}
                      min="1"
                      step="1"
                      placeholder="Height"
                    />{" "}
                    px
                  </label>
                </div>

                <div className="ratio-buttons">
                  <span>Resize proportionally:</span>
                  <button
                    onClick={() => handleRatioClick(2)}
                    disabled={isProcessing}
                  >
                    {" "}
                    / 2{" "}
                  </button>
                  <button
                    onClick={() => handleRatioClick(4)}
                    disabled={isProcessing}
                  >
                    {" "}
                    / 4{" "}
                  </button>
                  <button
                    onClick={() => handleRatioClick(6)}
                    disabled={isProcessing}
                  >
                    {" "}
                    / 6{" "}
                  </button>
                </div>
                <p className="info-text">
                  Note: If target aspect ratio differs, image will be centered
                  with a blurred background fill.
                </p>
              </>
            )}
            {/* --- End Dimension Controls --- */}

            {/* --- Quality Slider: Always show if images are loaded --- */}
            <div className="quality-slider">
              <label htmlFor="quality">
                AVIF Quality: {quality}% (Lower = Smaller File)
              </label>
              <input
                type="range"
                id="quality"
                min="0"
                max="100"
                value={quality}
                onChange={handleQualityChange}
                disabled={isProcessing}
              />
              <div className="quality-labels">
                <span>Lower Quality</span>
                <span>Higher Quality</span>
              </div>
            </div>
            {/* --- End Quality Slider --- */}

            <button
              className="download-button"
              onClick={handleDownload}
              disabled={
                isProcessing ||
                inputFiles.length === 0 ||
                loadedImages.length !== inputFiles.length || // Check if all selected files are loaded
                (showDimensionControls &&
                  (!targetWidth ||
                    !targetHeight ||
                    targetWidth <= 0 ||
                    targetHeight <= 0)) // Dimension check only for single mode
              }
            >
              {isProcessing
                ? "Processing..."
                : `3. Download AVIF (${inputFiles.length})`}
            </button>
          </div>{" "}
        </div> // End controls-and-preview
      )}

      {/* Hidden canvas used for processing the image */}
      <canvas ref={outputCanvasRef} style={{ display: "none" }}></canvas>
    </div>
  );
}

export default App;
