import React, { useState, useRef, useEffect, useCallback } from "react";
import { encode } from "@jsquash/avif";
import "./App.css";

function App() {
  const [inputFile, setInputFile] = useState(null);
  const [originalDimensions, setOriginalDimensions] = useState(null);
  const [targetWidth, setTargetWidth] = useState("");
  const [targetHeight, setTargetHeight] = useState("");
  const [quality, setQuality] = useState(75); // Default quality percentage
  const [imageUrl, setImageUrl] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState("");

  const outputCanvasRef = useRef(null);
  const imageRef = useRef(null); // To hold the Image object for drawing

  // Clean up ObjectURL
  useEffect(() => {
    return () => {
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl);
      }
    };
  }, [imageUrl]);

  const handleFileChange = (event) => {
    const file = event.target.files[0];
    setError("");
    setOriginalDimensions(null);
    setTargetWidth("");
    setTargetHeight("");
    imageRef.current = null;

    // Revoke previous object URL if one exists
    if (imageUrl && imageUrl.startsWith("blob:")) {
      URL.revokeObjectURL(imageUrl);
    }
    setImageUrl(null); // Reset image URL state

    if (file && file.type.startsWith("image/")) {
      setInputFile(file);
      const reader = new FileReader();

      reader.onload = (e) => {
        const dataUrl = e.target.result; // Use Data URL initially
        setImageUrl(dataUrl); // Set preview URL

        const img = new Image();
        img.onload = () => {
          imageRef.current = img; // Store the loaded image object
          const dimensions = {
            width: img.naturalWidth,
            height: img.naturalHeight,
          };
          setOriginalDimensions(dimensions);
          setTargetWidth(dimensions.width.toString());
          setTargetHeight(dimensions.height.toString());
        };
        img.onerror = () => {
          setError(
            "Failed to load image dimensions. The file might be corrupt or an unsupported format."
          );
          setImageUrl(null); // Clear preview on error
          setInputFile(null);
        };
        img.src = dataUrl;
      };
      reader.onerror = () => {
        setError("Failed to read file.");
        setInputFile(null);
      };
      reader.readAsDataURL(file); // Read as Data URL for direct use in Image src
    } else {
      setInputFile(null);
      if (file) {
        // Only show error if a file was actually selected
        setError(
          "Please select a valid image file (e.g., PNG, JPG, GIF, WEBP)."
        );
      }
    }
    // Reset file input value so selecting the same file again triggers onChange
    event.target.value = null;
  };

  const handleDimensionChange = (value, type) => {
    const numValue = value.replace(/\D/g, ""); // Allow only digits
    if (type === "width") {
      setTargetWidth(numValue);
    } else {
      setTargetHeight(numValue);
    }
  };

  const handleRatioClick = (divisor) => {
    if (originalDimensions) {
      const newWidth = Math.max(
        1,
        Math.round(originalDimensions.width / divisor)
      ); // Ensure minimum 1px
      const newHeight = Math.max(
        1,
        Math.round(originalDimensions.height / divisor)
      ); // Ensure minimum 1px
      setTargetWidth(newWidth.toString());
      setTargetHeight(newHeight.toString());
    }
  };

  const handleQualityChange = (event) => {
    setQuality(parseInt(event.target.value, 10));
  };

  // Use useCallback to memoize the canvas drawing function
  const drawCanvas = useCallback((img, canvas, tWidth, tHeight) => {
    const ctx = canvas.getContext("2d");
    if (!ctx || !img) return null;

    // Ensure dimensions are positive integers
    tWidth = Math.max(1, Math.round(tWidth));
    tHeight = Math.max(1, Math.round(tHeight));

    const oWidth = img.naturalWidth;
    const oHeight = img.naturalHeight;

    canvas.width = tWidth;
    canvas.height = tHeight;

    // --- Background Blur ---
    // Calculate scale to cover the canvas while maintaining aspect ratio
    const coverScale = Math.max(tWidth / oWidth, tHeight / oHeight);
    const coverWidth = oWidth * coverScale;
    const coverHeight = oHeight * coverScale;
    const coverX = (tWidth - coverWidth) / 2;
    const coverY = (tHeight - coverHeight) / 2;

    // Apply blur filter
    ctx.filter = "blur(15px) brightness(0.9)"; // Adjust blur amount and brightness as needed
    ctx.imageSmoothingEnabled = true; // Enable smoothing for better blur quality
    ctx.imageSmoothingQuality = "high";

    // Draw the image scaled to cover the canvas
    ctx.drawImage(img, coverX, coverY, coverWidth, coverHeight);

    // Draw the blurred image onto itself to ensure edge pixels are blurred correctly
    // This can sometimes help with edge artifacts depending on browser implementation
    ctx.drawImage(canvas, 0, 0);

    // Reset filter and smoothing for the main image
    ctx.filter = "none";
    ctx.imageSmoothingEnabled = false;

    // --- Foreground Centered Image ---
    // Calculate scale to fit the image within the canvas while maintaining aspect ratio
    const fitScale = Math.min(tWidth / oWidth, tHeight / oHeight);
    const scaledWidth = oWidth * fitScale;
    const scaledHeight = oHeight * fitScale;
    const x = (tWidth - scaledWidth) / 2;
    const y = (tHeight - scaledHeight) / 2;

    // Draw the original image, centered and scaled to fit
    ctx.drawImage(img, x, y, scaledWidth, scaledHeight);

    return ctx; // Return the context, although we mostly need the canvas data later
  }, []); // No dependencies needed if it only uses its arguments

  const handleDownload = async () => {
    if (
      !inputFile ||
      !imageRef.current ||
      !outputCanvasRef.current ||
      isProcessing
    ) {
      setError("Upload an image and set dimensions first.");
      return;
    }

    const currentTargetWidth = parseInt(targetWidth, 10);
    const currentTargetHeight = parseInt(targetHeight, 10);

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

    setError("");
    setIsProcessing(true);

    try {
      const canvas = outputCanvasRef.current;
      const img = imageRef.current;

      // Ensure the image object is ready
      if (!img.complete || img.naturalWidth === 0) {
        // Attempt to wait a short moment if not complete, might help race conditions
        await new Promise((resolve) => setTimeout(resolve, 100));
        if (!img.complete || img.naturalWidth === 0) {
          throw new Error("Image data is not available for processing.");
        }
      }

      // Draw the image onto the canvas with background blur/padding
      const ctx = drawCanvas(
        img,
        canvas,
        currentTargetWidth,
        currentTargetHeight
      );

      if (!ctx) {
        throw new Error("Failed to get canvas 2D context.");
      }

      // Get ImageData from the canvas
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      // Map slider quality (0-100) to AVIF cqLevel (0-63, lower is better quality)
      // This is a common but adjustable mapping. 100 = minimal compression, 0 = max compression.
      // Lower cqLevel means higher quality and larger file size.
      // Let's map 100 -> 10, 75 -> ~25, 50 -> ~40, 25 -> ~52, 0 -> 63
      const cqLevel = Math.round(63 - (quality / 100) * 53); // Maps 0-100 roughly to 63-10

      console.log(
        `Encoding AVIF with Quality: ${quality}% -> CQ Level: ${cqLevel}`
      );

      // Encode the ImageData to AVIF
      const avifBuffer = await encode(imageData, {
        cqLevel: Math.max(0, Math.min(63, cqLevel)), // Clamp CQ level to valid range 0-63
        // Speed determines encoding effort (0=slowest/best compression, 10=fastest/worst compression)
        // Speed 6 is often a good balance for client-side web use.
        speed: 6,
        // You can add other options like `subsample` (chroma subsampling) if needed
        // subsample: 1 // (4:4:4 - no chroma subsampling)
        // subsample: 2 // (4:2:0 - default, good compression)
      });

      if (!avifBuffer) {
        throw new Error("AVIF encoding returned empty buffer.");
      }

      // Create a Blob and download link
      const blob = new Blob([avifBuffer], { type: "image/avif" });
      const downloadUrl = URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.href = downloadUrl;
      // Create a filename
      const originalFileName =
        inputFile.name.substring(0, inputFile.name.lastIndexOf(".")) ||
        inputFile.name;
      link.download = `${originalFileName}_${currentTargetWidth}x${currentTargetHeight}_q${quality}.avif`;

      // Trigger download
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // Clean up the Blob URL
      URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      console.error("Encoding or Download failed:", err);
      setError(
        `Error: ${
          err.message || "AVIF encoding failed. Check console for details."
        }`
      );
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="App">
      <h1>Any Image to AVIF Converter</h1>

      <div className="control-section upload-section">
        <label htmlFor="file-upload" className="custom-file-upload">
          {inputFile ? `Selected: ${inputFile.name}` : "1. Upload Image"}
        </label>
        <input
          id="file-upload"
          type="file"
          onChange={handleFileChange}
          accept="image/png, image/jpeg, image/gif, image/webp, image/bmp" // Be specific or use image/*
          disabled={isProcessing}
        />
      </div>

      {error && <p className="error-message">{error}</p>}

      {/* Only show controls and preview when an image is successfully loaded */}
      {originalDimensions && imageUrl && (
        <div className="controls-and-preview">
          <div className="controls">
            <h2>2. Adjust Settings</h2>
            <div className="dimension-info">
              Original: {originalDimensions.width} x {originalDimensions.height}{" "}
              px
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
                disabled={isProcessing || !originalDimensions}
              >
                / 2
              </button>
              <button
                onClick={() => handleRatioClick(4)}
                disabled={isProcessing || !originalDimensions}
              >
                / 4
              </button>
              <button
                onClick={() => handleRatioClick(6)}
                disabled={isProcessing || !originalDimensions}
              >
                / 6
              </button>
            </div>
            <p className="info-text">
              Note: If target aspect ratio differs, image will be centered with
              a blurred background fill.
            </p>

            <div className="quality-slider">
              <label htmlFor="quality">AVIF Quality: {quality}%</label>
              <input
                type="range"
                id="quality"
                min="0" // 0 = Max compression, Lowest quality
                max="100" // 100 = Min compression, Highest quality
                value={quality}
                onChange={handleQualityChange}
                disabled={isProcessing}
              />
              <div className="quality-labels">
                <span>Lower Quality</span>
                <span>Higher Quality</span>
              </div>
            </div>

            <button
              className="download-button"
              onClick={handleDownload}
              disabled={
                isProcessing ||
                !inputFile ||
                !targetWidth ||
                !targetHeight ||
                targetWidth <= 0 ||
                targetHeight <= 0
              }
            >
              {isProcessing ? "Processing..." : "3. Download AVIF"}
            </button>
          </div>

          <div className="preview">
            <h2>Preview</h2>
            <p>(Shows the original uploaded image)</p>
            {/* Use the imageUrl state which holds the Data URL or Object URL */}
            <img
              src={imageUrl}
              alt="Upload preview"
              style={{
                maxWidth: "100%",
                maxHeight: "400px",
                display: "block",
                objectFit: "contain",
              }}
              onError={() => setError("Preview failed to load.")} // Handle potential image loading error
            />
          </div>
        </div>
      )}

      {/* Hidden canvas used for processing the image */}
      <canvas ref={outputCanvasRef} style={{ display: "none" }}></canvas>
    </div>
  );
}

export default App;
