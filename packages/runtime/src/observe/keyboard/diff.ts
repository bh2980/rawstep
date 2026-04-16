import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

type ScreenshotPayload = {
  pngBase64: string;
  viewport: { w: number; h: number };
};

type DiffScreenshotPayload = ScreenshotPayload & {
  changeRatio: number;
};

export function createDiffScreenshot(
  previousScreenshot: ScreenshotPayload,
  currentScreenshot: ScreenshotPayload,
): DiffScreenshotPayload | undefined {
  const previous = PNG.sync.read(Buffer.from(previousScreenshot.pngBase64, "base64"));
  const current = PNG.sync.read(Buffer.from(currentScreenshot.pngBase64, "base64"));

  if (
    previous.width !== current.width
    || previous.height !== current.height
  ) {
    return undefined;
  }

  const diff = new PNG({ width: current.width, height: current.height });
  const changedPixels = pixelmatch(
    previous.data,
    current.data,
    diff.data,
    current.width,
    current.height,
    {
      threshold: 0.12,
      alpha: 0.14,
      diffColor: [255, 76, 76],
      diffColorAlt: [37, 99, 235],
      includeAA: false,
    },
  );

  return {
    pngBase64: PNG.sync.write(diff).toString("base64"),
    viewport: currentScreenshot.viewport,
    changeRatio: changedPixels / (current.width * current.height),
  };
}
