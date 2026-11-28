export interface ChartPngCompositeOptions {
  baseCanvas: HTMLCanvasElement;
  svgOverlay?: SVGSVGElement | null;
  headerTitle: string;
  headerMeta?: string;
  footerText?: string;
  dark: boolean;
}

function drawRoundedTopCanvas(
  baseCanvas: HTMLCanvasElement,
  opts: Omit<ChartPngCompositeOptions, 'baseCanvas' | 'svgOverlay'>
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; chartY: number; chartW: number; chartH: number } {
  const headerH = opts.headerMeta ? 54 : 38;
  const footerH = opts.footerText ? 30 : 0;
  const chartW = Math.max(1, baseCanvas.width);
  const chartH = Math.max(1, baseCanvas.height);

  // Respect devicePixelRatio proportions stored on Lightweight Charts canvas
  const dpr = Math.max(1, Math.min(2, chartW / Math.max(1, baseCanvas.clientWidth || chartW)));
  const scaledHeaderH = Math.round(headerH * dpr);
  const scaledFooterH = Math.round(footerH * dpr);

  const out = document.createElement('canvas');
  out.width = chartW;
  out.height = scaledHeaderH + chartH + scaledFooterH;

  const ctx = out.getContext('2d');
  if (!ctx) {
    throw new Error('Unable to initialize 2D export canvas');
  }

  const bg = opts.dark ? '#0b1220' : '#ffffff';
  const barBg = opts.dark ? '#0f172a' : '#f8fafc';
  const borderCol = opts.dark ? '#1e293b' : '#e2e8f0';
  const primaryText = opts.dark ? '#f1f5f9' : '#0f172a';
  const secondaryText = opts.dark ? '#94a3b8' : '#475569';
  const accentText = opts.dark ? '#60a5fa' : '#2563eb';

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, out.width, out.height);

  // Header band
  ctx.fillStyle = barBg;
  ctx.fillRect(0, 0, out.width, scaledHeaderH);
  ctx.strokeStyle = borderCol;
  ctx.lineWidth = Math.max(1, dpr);
  ctx.beginPath();
  ctx.moveTo(0, scaledHeaderH - 0.5);
  ctx.lineTo(out.width, scaledHeaderH - 0.5);
  ctx.stroke();

  const padX = Math.round(14 * dpr);
  ctx.textBaseline = 'middle';

  // Primary header line
  ctx.font = `700 ${Math.round(13 * dpr)}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
  ctx.fillStyle = primaryText;
  ctx.fillText(opts.headerTitle, padX, Math.round((opts.headerMeta ? 18 : 19) * dpr));

  // Right watermark tag (subtle domain attribution)
  const brandLabel = `NEPSE Workbench · ${new Date().toISOString().slice(0, 10)}`;
  ctx.font = `600 ${Math.round(10.5 * dpr)}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
  const brandW = ctx.measureText(brandLabel).width;
  ctx.fillStyle = accentText;
  ctx.fillText(brandLabel, Math.max(padX, out.width - brandW - padX), Math.round((opts.headerMeta ? 18 : 19) * dpr));

  // Secondary metadata line
  if (opts.headerMeta) {
    ctx.font = `500 ${Math.round(11 * dpr)}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
    ctx.fillStyle = secondaryText;
    ctx.fillText(opts.headerMeta, padX, Math.round(39 * dpr));
  }

  // Base Lightweight-Charts canvas
  ctx.drawImage(baseCanvas, 0, scaledHeaderH, chartW, chartH);

  // Optional footer strip
  if (opts.footerText && scaledFooterH > 0) {
    const fy = scaledHeaderH + chartH;
    ctx.fillStyle = barBg;
    ctx.fillRect(0, fy, out.width, scaledFooterH);
    ctx.strokeStyle = borderCol;
    ctx.beginPath();
    ctx.moveTo(0, fy + 0.5);
    ctx.lineTo(out.width, fy + 0.5);
    ctx.stroke();

    ctx.font = `500 ${Math.round(11 * dpr)}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
    ctx.fillStyle = secondaryText;
    ctx.fillText(opts.footerText, padX, fy + scaledFooterH / 2);
  }

  return { canvas: out, ctx, chartY: scaledHeaderH, chartW, chartH };
}

export function composeChartPngSync(
  opts: Omit<ChartPngCompositeOptions, 'svgOverlay'>
): string {
  const { canvas } = drawRoundedTopCanvas(opts.baseCanvas, opts);
  return canvas.toDataURL('image/png');
}

export async function composeChartPngWithSvg(
  opts: ChartPngCompositeOptions
): Promise<string> {
  const { canvas, ctx, chartY, chartW, chartH } = drawRoundedTopCanvas(opts.baseCanvas, opts);

  if (opts.svgOverlay && opts.svgOverlay.children.length > 0) {
    try {
      const rect = opts.svgOverlay.getBoundingClientRect();
      const svgW = Math.max(1, Math.round(rect.width) || opts.baseCanvas.clientWidth || chartW);
      const svgH = Math.max(1, Math.round(rect.height) || opts.baseCanvas.clientHeight || chartH);

      const clone = opts.svgOverlay.cloneNode(true) as SVGSVGElement;
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      clone.setAttribute('width', String(svgW));
      clone.setAttribute('height', String(svgH));
      clone.setAttribute('viewBox', `0 0 ${svgW} ${svgH}`);

      const xml = new XMLSerializer().serializeToString(clone);
      const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;

      await new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, 0, chartY, chartW, chartH);
          resolve();
        };
        img.onerror = () => resolve();
        img.src = svgDataUrl;
      });
    } catch {
      // Fallback gracefully without blocking export
    }
  }

  return canvas.toDataURL('image/png');
}

export function triggerPngDownload(dataUrl: string, filename: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.click();
}
