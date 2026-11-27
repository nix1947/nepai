import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  createChart,
  createSeriesMarkers,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type IPrimitivePaneRenderer,
  type IPrimitivePaneView,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type ISeriesPrimitive,
  type SeriesAttachedParameter,
  type SeriesMarker,
  type Time,
} from 'lightweight-charts';
import type {
  AnalyzerBar,
  AnalyzerResponse,
  AnalyzerSetup,
  OverlayToggleState,
} from '../../types/analyzer';
import { formatNum } from '../../utils/format';

export interface AnalyzerChartHandle {
  exportPng: () => string | null;
  fitContent: () => void;
}

interface AnalyzerChartProps {
  data: AnalyzerResponse;
  overlays: OverlayToggleState;
  selectedSetup: AnalyzerSetup | null;
}

interface PrimitiveState {
  data: AnalyzerResponse;
  overlays: OverlayToggleState;
  selectedSetup: AnalyzerSetup | null;
  dark: boolean;
}

class AnalyzerOverlayPrimitive implements ISeriesPrimitive<Time> {
  private _chart: IChartApi | null = null;
  private _series: ISeriesApi<'Candlestick', Time> | null = null;
  private _requestUpdate?: () => void;
  private _state: PrimitiveState;

  constructor(initial: PrimitiveState) {
    this._state = initial;
  }

  public updateState(next: PrimitiveState): void {
    this._state = next;
    this._requestUpdate?.();
  }

  public attached(param: SeriesAttachedParameter<Time, 'Candlestick'>): void {
    this._chart = param.chart;
    this._series = param.series;
    this._requestUpdate = param.requestUpdate;
  }

  public detached(): void {
    this._chart = null;
    this._series = null;
    this._requestUpdate = undefined;
  }

  public updateAllViews(): void {
    // State is read dynamically during render
  }

  public paneViews(): readonly IPrimitivePaneView[] {
    if (!this._chart || !this._series) return [];
    const chart = this._chart;
    const series = this._series;
    const state = this._state;

    const renderer: IPrimitivePaneRenderer = {
      draw(target) {
        target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
          const { data, overlays, selectedSetup, dark } = state;
          const bars = data.bars;
          if (!bars.length) return;

          const timeScale = chart.timeScale();
          const lastBar = bars[bars.length - 1];
          const lastBarX = timeScale.timeToCoordinate(lastBar.date as Time);
          const rightEdge = Math.min(
            mediaSize.width - 4,
            lastBarX !== null ? lastBarX + 44 : mediaSize.width - 4
          );

          const xForDate = (dateStr: string | null | undefined, fallbackRight = rightEdge): number => {
            if (!dateStr) return fallbackRight;
            const x = timeScale.timeToCoordinate(dateStr as Time);
            if (x === null) {
              if (dateStr <= bars[0].date) return 0;
              return fallbackRight;
            }
            return x;
          };

          const yForPrice = (price: number): number | null => series.priceToCoordinate(price);

          const drawLabel = (text: string, x: number, y: number, color: string, align: CanvasTextAlign = 'left') => {
            ctx.save();
            ctx.font = '600 10px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
            const padX = 4;
            const metrics = ctx.measureText(text);
            const boxW = metrics.width + padX * 2;
            const boxH = 14;
            const drawX = align === 'right' ? x - boxW : x;
            const clampedX = Math.max(2, Math.min(mediaSize.width - boxW - 2, drawX));
            const clampedY = Math.max(2, Math.min(mediaSize.height - boxH - 2, y - boxH / 2));
            ctx.fillStyle = dark ? 'rgba(15, 23, 42, 0.85)' : 'rgba(255, 255, 255, 0.9)';
            ctx.fillRect(clampedX, clampedY, boxW, boxH);
            ctx.strokeStyle = color;
            ctx.lineWidth = 0.75;
            ctx.strokeRect(clampedX, clampedY, boxW, boxH);
            ctx.fillStyle = color;
            ctx.textBaseline = 'middle';
            ctx.fillText(text, clampedX + padX, clampedY + boxH / 2 + 0.5);
            ctx.restore();
          };

          ctx.save();

          // 1. Premium / Discount / OTE / Weekly Open
          if (overlays.premiumDiscountOte && data.premiumDiscount) {
            const pd = data.premiumDiscount;
            const lookbackStart =
              bars[Math.max(0, bars.length - pd.rangeLookbackBars)]?.date ?? bars[0].date;
            const x1 = Math.max(0, xForDate(lookbackStart, 0));
            const x2 = rightEdge;
            const yOteTop = yForPrice(pd.oteLow);
            const yOteBot = yForPrice(pd.oteHigh);
            if (yOteTop !== null && yOteBot !== null) {
              const top = Math.min(yOteTop, yOteBot);
              const h = Math.max(2, Math.abs(yOteBot - yOteTop));
              ctx.fillStyle = dark ? 'rgba(14, 165, 233, 0.08)' : 'rgba(14, 165, 233, 0.09)';
              ctx.fillRect(x1, top, Math.max(10, x2 - x1), h);
              drawLabel('OTE 0.62–0.79', x1 + 4, top + h / 2, '#0284c7');
            }

            const yEq = yForPrice(pd.equilibrium);
            if (yEq !== null) {
              ctx.save();
              ctx.setLineDash([5, 4]);
              ctx.strokeStyle = dark ? 'rgba(148, 163, 184, 0.65)' : 'rgba(100, 116, 139, 0.65)';
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(x1, yEq);
              ctx.lineTo(x2, yEq);
              ctx.stroke();
              ctx.restore();
              drawLabel(`EQ 50% (${pd.equilibrium.toFixed(1)})`, x2 - 4, yEq, '#64748b', 'right');
            }

            if (pd.weeklyPo3.weeklyOpen !== null) {
              const yWo = yForPrice(pd.weeklyPo3.weeklyOpen);
              if (yWo !== null) {
                ctx.save();
                ctx.setLineDash([2, 3]);
                ctx.strokeStyle = 'rgba(168, 85, 247, 0.7)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(Math.max(0, x2 - 140), yWo);
                ctx.lineTo(x2, yWo);
                ctx.stroke();
                ctx.restore();
                drawLabel(`W.Open ${pd.weeklyPo3.weeklyOpen.toFixed(1)}`, x2 - 4, yWo - 10, '#9333ea', 'right');
              }
            }
          }

          // 2. Support / Resistance Zones
          if (overlays.srZones) {
            for (const sr of data.srZones.slice(0, 8)) {
              const yTop = yForPrice(sr.top);
              const yBot = yForPrice(sr.bottom);
              if (yTop === null || yBot === null) continue;
              const top = Math.min(yTop, yBot);
              const h = Math.max(2, Math.abs(yBot - yTop));
              const isSup = sr.kind === 'Support';
              const isFlip = sr.kind === 'Flip';
              const fill = isFlip
                ? 'rgba(217, 119, 6, 0.11)'
                : isSup
                  ? 'rgba(16, 185, 129, 0.09)'
                  : 'rgba(239, 68, 68, 0.09)';
              const stroke = isFlip ? '#d97706' : isSup ? '#059669' : '#dc2626';
              ctx.fillStyle = fill;
              ctx.fillRect(0, top, rightEdge, h);
              ctx.strokeStyle = stroke;
              ctx.lineWidth = 0.7;
              ctx.strokeRect(0, top, rightEdge, h);
              drawLabel(`${sr.kind} ×${sr.touches}`, 6, top + h / 2, stroke);
            }
          }

          // 3. Supply / Demand Zones
          if (overlays.supplyDemand) {
            for (const sd of data.supplyDemandZones.slice(-10)) {
              const yTop = yForPrice(sd.top);
              const yBot = yForPrice(sd.bottom);
              if (yTop === null || yBot === null) continue;
              const x1 = xForDate(sd.startDate, 0);
              const top = Math.min(yTop, yBot);
              const h = Math.max(3, Math.abs(yBot - yTop));
              const color = sd.kind === 'Demand' ? '#0d9488' : '#e11d48';
              ctx.fillStyle =
                sd.kind === 'Demand' ? 'rgba(13, 148, 136, 0.12)' : 'rgba(225, 29, 72, 0.11)';
              ctx.fillRect(x1, top, Math.max(18, rightEdge - x1), h);
              ctx.strokeStyle = color;
              ctx.lineWidth = 0.8;
              ctx.strokeRect(x1, top, Math.max(18, rightEdge - x1), h);
              drawLabel(`${sd.pattern} (${sd.freshness})`, x1 + 3, top + h / 2, color);
            }
          }

          // 4. Imbalances (FVG / IFVG / BPR / Vol Imb / Gaps / Voids)
          const visibleImbalances = data.imbalances.filter((z) => {
            if (z.kind === 'FVG') return overlays.fvg;
            if (z.kind === 'IFVG' || z.kind === 'BPR') return overlays.ifvgAndBpr;
            return overlays.volumeImbalanceAndVoids;
          });

          for (const imb of visibleImbalances.slice(-22)) {
            const yTop = yForPrice(imb.top);
            const yBot = yForPrice(imb.bottom);
            if (yTop === null || yBot === null) continue;
            const x1 = xForDate(imb.startDate, 0);
            const x2 = imb.mitigatedDate ? xForDate(imb.mitigatedDate, rightEdge) : rightEdge;
            const width = Math.max(14, x2 - x1);
            const top = Math.min(yTop, yBot);
            const h = Math.max(3, Math.abs(yBot - yTop));

            let fill = 'rgba(16, 185, 129, 0.16)';
            let stroke = '#10b981';
            if (imb.kind === 'IFVG') {
              fill = 'rgba(139, 92, 246, 0.15)';
              stroke = '#8b5cf6';
            } else if (imb.kind === 'BPR') {
              fill = 'rgba(245, 158, 11, 0.18)';
              stroke = '#d97706';
            } else if (imb.kind === 'VolumeImbalance' || imb.kind === 'LiquidityVoid') {
              fill = 'rgba(59, 130, 246, 0.13)';
              stroke = '#3b82f6';
            } else if (imb.kind === 'Gap') {
              fill = imb.corpActionFlagged
                ? 'rgba(245, 158, 11, 0.14)'
                : 'rgba(100, 116, 139, 0.16)';
              stroke = imb.corpActionFlagged ? '#f59e0b' : '#64748b';
            } else if (imb.direction === 'bearish') {
              fill = 'rgba(239, 68, 68, 0.15)';
              stroke = '#ef4444';
            }

            if (imb.status === 'filled') {
              fill = fill.replace(/0\.\d+\)/, '0.05)');
            }

            ctx.fillStyle = fill;
            ctx.fillRect(x1, top, width, h);
            ctx.strokeStyle = stroke;
            ctx.lineWidth = 0.8;
            ctx.strokeRect(x1, top, width, h);

            // CE 50% dashed line for FVG / IFVG / BPR
            if (imb.kind === 'FVG' || imb.kind === 'IFVG' || imb.kind === 'BPR') {
              const yCe = yForPrice(imb.ce50);
              if (yCe !== null) {
                ctx.save();
                ctx.setLineDash([3, 3]);
                ctx.strokeStyle = stroke;
                ctx.lineWidth = 0.8;
                ctx.beginPath();
                ctx.moveTo(x1, yCe);
                ctx.lineTo(x1 + width, yCe);
                ctx.stroke();
                ctx.restore();
              }
            }

            if (width > 24 && imb.status !== 'filled') {
              drawLabel(
                `${imb.label}${imb.mitigatedPct > 0 ? ` (${imb.mitigatedPct.toFixed(0)}%)` : ''}`,
                x1 + 3,
                top + 7,
                stroke
              );
            }
          }

          // 5. Order Blocks & Advanced Blocks
          const visibleObs = data.orderBlocks.filter((ob) =>
            ob.kind === 'OB' ? overlays.orderBlocks : overlays.advancedBlocks
          );

          for (const ob of visibleObs.slice(-18)) {
            const yTop = yForPrice(ob.top);
            const yBot = yForPrice(ob.bottom);
            if (yTop === null || yBot === null) continue;
            const x1 = xForDate(ob.startDate, 0);
            const width = Math.max(18, rightEdge - x1);
            const top = Math.min(yTop, yBot);
            const h = Math.max(4, Math.abs(yBot - yTop));

            let fill =
              ob.direction === 'bullish'
                ? 'rgba(37, 99, 235, 0.17)'
                : 'rgba(220, 38, 38, 0.16)';
            let stroke = ob.direction === 'bullish' ? '#2563eb' : '#dc2626';

            if (ob.kind === 'Unicorn') {
              fill = 'rgba(234, 179, 8, 0.22)';
              stroke = '#ca8a04';
            } else if (ob.kind === 'Breaker') {
              fill = 'rgba(168, 85, 247, 0.18)';
              stroke = '#9333ea';
            } else if (ob.kind === 'Propulsion' || ob.kind === 'Mitigation' || ob.kind === 'Rejection' || ob.kind === 'Vacuum') {
              fill = 'rgba(6, 182, 212, 0.15)';
              stroke = '#0891b2';
            }

            if (ob.status === 'broken') {
              fill = fill.replace(/0\.\d+\)/, '0.05)');
            }

            ctx.fillStyle = fill;
            ctx.fillRect(x1, top, width, h);
            ctx.strokeStyle = stroke;
            ctx.lineWidth = ob.kind === 'Unicorn' ? 1.4 : 0.9;
            ctx.strokeRect(x1, top, width, h);

            const yMt = yForPrice(ob.meanThreshold);
            if (yMt !== null) {
              ctx.save();
              ctx.setLineDash([4, 3]);
              ctx.strokeStyle = stroke;
              ctx.lineWidth = 0.7;
              ctx.beginPath();
              ctx.moveTo(x1, yMt);
              ctx.lineTo(x1 + width, yMt);
              ctx.stroke();
              ctx.restore();
            }

            if (ob.status !== 'broken') {
              drawLabel(`${ob.label}`, x1 + 4, top + h - 7, stroke);
            }
          }

          // 6. Liquidity Levels & Sweeps (✕)
          const visibleLiq = data.liquidityLevels.filter((lv) => {
            if (lv.kind === 'Inducement') return overlays.sweepsAndInducement;
            return overlays.liquidityLevels;
          });

          for (const lv of visibleLiq) {
            const y = yForPrice(lv.price);
            if (y === null) continue;
            const x1 = xForDate(lv.startDate, 0);
            const x2 = lv.swept && lv.sweptDate ? xForDate(lv.sweptDate, rightEdge) : rightEdge;
            const isReference = ['PDH', 'PDL', 'PWH', 'PWL', 'PMH', 'PML', 'W52H', 'W52L'].includes(lv.kind);
            const color =
              lv.kind === 'Inducement'
                ? '#f97316'
                : lv.side === 'buyside'
                  ? '#ef4444'
                  : '#10b981';

            ctx.save();
            if (isReference || lv.kind === 'Inducement') ctx.setLineDash([4, 3]);
            ctx.strokeStyle = color;
            ctx.lineWidth = lv.kind === 'EQH' || lv.kind === 'EQL' ? 1.4 : 1;
            ctx.beginPath();
            ctx.moveTo(x1, y);
            ctx.lineTo(Math.max(x1 + 8, x2), y);
            ctx.stroke();
            ctx.restore();

            drawLabel(
              `${lv.label}${lv.turtleSoup ? ' TS' : ''}`,
              Math.max(x1 + 8, x2) - 2,
              y,
              color,
              'right'
            );

            // Explicit ✕ Sweep Marker
            if (overlays.sweepsAndInducement && lv.swept && lv.sweptDate) {
              const sx = xForDate(lv.sweptDate, rightEdge);
              ctx.save();
              ctx.strokeStyle = color;
              ctx.lineWidth = 2;
              const r = 4.5;
              ctx.beginPath();
              ctx.moveTo(sx - r, y - r);
              ctx.lineTo(sx + r, y + r);
              ctx.moveTo(sx + r, y - r);
              ctx.lineTo(sx - r, y + r);
              ctx.stroke();
              ctx.restore();
            }
          }

          // 7. Trendlines & Channels
          if (overlays.trendlinesAndChannels) {
            for (const tl of data.trendlines) {
              const x1 = xForDate(tl.startDate, 0);
              const y1 = yForPrice(tl.startPrice);
              const x2 = xForDate(tl.endDate, rightEdge);
              const y2 = yForPrice(tl.endPrice);
              if (y1 === null || y2 === null) continue;
              const color = tl.kind.includes('Support') || tl.kind.includes('Bottom')
                ? '#0ea5e9'
                : '#f59e0b';
              ctx.save();
              ctx.strokeStyle = color;
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.moveTo(x1, y1);
              ctx.lineTo(x2, y2);
              ctx.stroke();
              ctx.restore();
            }
          }

          // 8. Chart Patterns
          if (overlays.chartPatterns) {
            for (const pat of data.chartPatterns) {
              if (pat.points.length < 2) continue;
              const color = pat.direction === 'bullish' ? '#16a34a' : '#dc2626';
              ctx.save();
              ctx.strokeStyle = color;
              ctx.lineWidth = 1.8;
              ctx.beginPath();
              let started = false;
              for (const pt of pat.points) {
                const px = xForDate(pt.date, rightEdge);
                const py = yForPrice(pt.price);
                if (py === null) continue;
                if (!started) {
                  ctx.moveTo(px, py);
                  started = true;
                } else {
                  ctx.lineTo(px, py);
                }
              }
              ctx.stroke();

              // Neckline / Trigger
              const yNeck = yForPrice(pat.necklineOrTrigger);
              const xStart = xForDate(pat.startDate, 0);
              const xEnd = xForDate(pat.endDate, rightEdge);
              if (yNeck !== null) {
                ctx.setLineDash([4, 3]);
                ctx.beginPath();
                ctx.moveTo(xStart, yNeck);
                ctx.lineTo(Math.min(rightEdge, xEnd + 36), yNeck);
                ctx.stroke();
                drawLabel(
                  `${pat.name} (${pat.status === 'Confirmed Breakout' ? 'Confirmed' : 'Forming'})`,
                  xStart + 4,
                  yNeck - 10,
                  color
                );
              }
              ctx.restore();
            }
          }

          // 9. Active Trade Box (Entry / Stop Loss / Target 1 / Target 2)
          if (overlays.tradeBox && selectedSetup?.tradePlan.valid) {
            const tp = selectedSetup.tradePlan;
            const yEntryLow = yForPrice(tp.entryLow);
            const yEntryHigh = yForPrice(tp.entryHigh);
            const yEntryMid = yForPrice(tp.entryMid);
            const yStop = yForPrice(tp.stopLoss);
            const yT1 = yForPrice(tp.target1);
            const yT2 = yForPrice(tp.target2);

            const boxLeft = Math.max(0, rightEdge - 190);
            const boxW = Math.max(70, rightEdge - boxLeft);

            if (yEntryMid !== null && yT2 !== null) {
              const top = Math.min(yEntryMid, yT2);
              const h = Math.max(4, Math.abs(yEntryMid - yT2));
              ctx.fillStyle = 'rgba(16, 185, 129, 0.12)';
              ctx.fillRect(boxLeft, top, boxW, h);
            }
            if (yEntryMid !== null && yStop !== null) {
              const top = Math.min(yEntryMid, yStop);
              const h = Math.max(4, Math.abs(yEntryMid - yStop));
              ctx.fillStyle = 'rgba(239, 68, 68, 0.13)';
              ctx.fillRect(boxLeft, top, boxW, h);
            }
            if (yEntryLow !== null && yEntryHigh !== null) {
              const top = Math.min(yEntryLow, yEntryHigh);
              const h = Math.max(3, Math.abs(yEntryHigh - yEntryLow));
              ctx.fillStyle = 'rgba(37, 99, 235, 0.22)';
              ctx.fillRect(boxLeft, top, boxW, h);
            }

            const drawLine = (y: number | null, color: string, label: string, dashed = false) => {
              if (y === null) return;
              ctx.save();
              if (dashed) ctx.setLineDash([4, 3]);
              ctx.strokeStyle = color;
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.moveTo(boxLeft, y);
              ctx.lineTo(boxLeft + boxW, y);
              ctx.stroke();
              ctx.restore();
              drawLabel(label, boxLeft + boxW - 2, y, color, 'right');
            };

            drawLine(yEntryMid, '#2563eb', `ENTRY ${tp.entryMid.toFixed(1)}`);
            drawLine(yStop, '#dc2626', `SL ${tp.stopLoss.toFixed(1)}`);
            drawLine(yT1, '#0d9488', `T1 ${tp.target1.toFixed(1)} (${tp.rrT1.toFixed(1)}R)`, true);
            drawLine(yT2, '#059669', `T2 ${tp.target2.toFixed(1)} (${tp.rrT2.toFixed(1)}R)`);
          }

          ctx.restore();
        });
      },
    };

    return [
      {
        zOrder: () => 'top',
        renderer: () => renderer,
      },
    ];
  }
}

function buildChartMarkers(
  data: AnalyzerResponse,
  overlays: OverlayToggleState
): SeriesMarker<Time>[] {
  const markers: SeriesMarker<Time>[] = [];

  // Circuit-locked and Corp-action indicators (always useful)
  for (const bar of data.bars) {
    if (bar.possibleCorpActionGap) {
      markers.push({
        time: bar.date as Time,
        position: 'aboveBar',
        color: '#f59e0b',
        shape: 'square',
        text: 'CA Gap',
      });
    } else if (bar.isUpperCircuit || bar.isLowerCircuit) {
      markers.push({
        time: bar.date as Time,
        position: bar.isUpperCircuit ? 'aboveBar' : 'belowBar',
        color: bar.isUpperCircuit ? '#10b981' : '#ef4444',
        shape: 'circle',
        text: bar.isUpperCircuit ? '+10%' : '-10%',
      });
    }
  }

  if (overlays.swings) {
    for (const sw of data.swings.slice(-45)) {
      if (sw.tier === 'minor') continue;
      markers.push({
        time: sw.date as Time,
        position: sw.kind === 'high' ? 'aboveBar' : 'belowBar',
        color:
          sw.label === 'HH' || sw.label === 'HL'
            ? '#059669'
            : sw.label === 'LH' || sw.label === 'LL'
              ? '#dc2626'
              : '#64748b',
        shape: sw.kind === 'high' ? 'arrowDown' : 'arrowUp',
        text: `${sw.label}${sw.tier === 'external' ? '*' : ''}`,
      });
    }
  }

  if (overlays.structureBreaks) {
    for (const br of data.structureBreaks.slice(-28)) {
      markers.push({
        time: br.date as Time,
        position: br.direction === 'bullish' ? 'belowBar' : 'aboveBar',
        color:
          br.kind === 'MSS'
            ? '#9333ea'
            : br.kind === 'CHoCH'
              ? '#d97706'
              : br.direction === 'bullish'
                ? '#0284c7'
                : '#e11d48',
        shape: br.direction === 'bullish' ? 'arrowUp' : 'arrowDown',
        text: br.kind,
      });
    }
  }

  if (overlays.displacement) {
    for (const dp of data.displacements.slice(-18)) {
      markers.push({
        time: dp.date as Time,
        position: dp.direction === 'bullish' ? 'belowBar' : 'aboveBar',
        color: '#0891b2',
        shape: 'circle',
        text: `DISP ${dp.bodyAtrMult.toFixed(1)}x`,
      });
    }
  }

  if (overlays.candlePatterns) {
    for (const cp of data.candlePatterns.slice(-22)) {
      const abbr =
        cp.pattern === 'Bullish Pin Bar' || cp.pattern === 'Bearish Pin Bar'
          ? 'Pin'
          : cp.pattern === 'Bullish Engulfing' || cp.pattern === 'Bearish Engulfing'
            ? 'Eng'
            : cp.pattern === 'Inside Bar'
              ? 'IB'
              : cp.pattern === 'Morning Star'
                ? 'M.Star'
                : 'E.Star';
      markers.push({
        time: cp.date as Time,
        position: cp.direction === 'bearish' ? 'aboveBar' : 'belowBar',
        color:
          cp.direction === 'bullish'
            ? '#16a34a'
            : cp.direction === 'bearish'
              ? '#dc2626'
              : '#64748b',
        shape: 'square',
        text: abbr,
      });
    }
  }

  if (overlays.wyckoff) {
    for (const ev of data.wyckoff.events) {
      const bullEv = ev.event === 'SC' || ev.event === 'AR' || ev.event === 'Spring' || ev.event === 'SOS' || ev.event === 'LPS' || ev.event === 'ST';
      markers.push({
        time: ev.date as Time,
        position: bullEv ? 'belowBar' : 'aboveBar',
        color: '#7c3aed',
        shape: 'circle',
        text: `W:${ev.event}`,
      });
    }
  }

  return markers.sort((a, b) => String(a.time).localeCompare(String(b.time)));
}

export const AnalyzerChart = forwardRef<AnalyzerChartHandle, AnalyzerChartProps>(
  ({ data, overlays, selectedSetup }, ref) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const candleRef = useRef<ISeriesApi<'Candlestick', Time> | null>(null);
    const volumeRef = useRef<ISeriesApi<'Histogram', Time> | null>(null);
    const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
    const primitiveRef = useRef<AnalyzerOverlayPrimitive | null>(null);
    const [hoveredBar, setHoveredBar] = useState<AnalyzerBar | null>(null);
    const [isDark, setIsDark] = useState<boolean>(() =>
      typeof document !== 'undefined' ? document.documentElement.classList.contains('dark') : false
    );

    const barsByDate = useMemo(() => {
      const m = new Map<string, AnalyzerBar>();
      for (const b of data.bars) m.set(b.date, b);
      return m;
    }, [data.bars]);

    useEffect(() => {
      if (typeof document === 'undefined') return;
      const obs = new MutationObserver(() => {
        setIsDark(document.documentElement.classList.contains('dark'));
      });
      obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
      return () => obs.disconnect();
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        exportPng: () => {
          if (!chartRef.current) return null;
          return chartRef.current.takeScreenshot().toDataURL('image/png');
        },
        fitContent: () => {
          chartRef.current?.timeScale().fitContent();
        },
      }),
      []
    );

    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;

      const chart = createChart(el, {
        layout: {
          background: { type: ColorType.Solid, color: isDark ? '#0f172a' : '#ffffff' },
          textColor: isDark ? '#cbd5e1' : '#334155',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          fontSize: 11,
        },
        grid: {
          vertLines: { color: isDark ? 'rgba(51, 65, 85, 0.45)' : 'rgba(226, 232, 240, 0.7)' },
          horzLines: { color: isDark ? 'rgba(51, 65, 85, 0.45)' : 'rgba(226, 232, 240, 0.7)' },
        },
        crosshair: {
          mode: CrosshairMode.Normal,
        },
        rightPriceScale: {
          borderColor: isDark ? '#1e293b' : '#e2e8f0',
          scaleMargins: { top: 0.08, bottom: 0.22 },
        },
        timeScale: {
          borderColor: isDark ? '#1e293b' : '#e2e8f0',
          timeVisible: false,
          rightOffset: 10,
        },
        height: 520,
      });

      const candleSeries = chart.addSeries(CandlestickSeries, {
        upColor: '#059669',
        downColor: '#e11d48',
        borderUpColor: '#059669',
        borderDownColor: '#e11d48',
        wickUpColor: '#059669',
        wickDownColor: '#e11d48',
      });

      const volumeSeries = chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceScaleId: '',
      });
      volumeSeries.priceScale().applyOptions({
        scaleMargins: { top: 0.82, bottom: 0 },
      });

      const markersPlugin = createSeriesMarkers(candleSeries, []);
      const primitive = new AnalyzerOverlayPrimitive({
        data,
        overlays,
        selectedSetup,
        dark: isDark,
      });
      candleSeries.attachPrimitive(primitive);

      chartRef.current = chart;
      candleRef.current = candleSeries;
      volumeRef.current = volumeSeries;
      markersPluginRef.current = markersPlugin;
      primitiveRef.current = primitive;

      const resizeObs = new ResizeObserver((entries) => {
        for (const entry of entries) {
          chart.applyOptions({ width: Math.floor(entry.contentRect.width) });
        }
      });
      resizeObs.observe(el);

      chart.subscribeCrosshairMove((param) => {
        if (!param.time) {
          setHoveredBar(null);
          return;
        }
        const dt = String(param.time);
        setHoveredBar(barsByDate.get(dt) ?? null);
      });

      return () => {
        resizeObs.disconnect();
        candleSeries.detachPrimitive(primitive);
        chart.remove();
        chartRef.current = null;
        candleRef.current = null;
        volumeRef.current = null;
        markersPluginRef.current = null;
        primitiveRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
      if (!chartRef.current) return;
      chartRef.current.applyOptions({
        layout: {
          background: { type: ColorType.Solid, color: isDark ? '#0f172a' : '#ffffff' },
          textColor: isDark ? '#cbd5e1' : '#334155',
        },
        grid: {
          vertLines: { color: isDark ? 'rgba(51, 65, 85, 0.45)' : 'rgba(226, 232, 240, 0.7)' },
          horzLines: { color: isDark ? 'rgba(51, 65, 85, 0.45)' : 'rgba(226, 232, 240, 0.7)' },
        },
        rightPriceScale: { borderColor: isDark ? '#1e293b' : '#e2e8f0' },
        timeScale: { borderColor: isDark ? '#1e293b' : '#e2e8f0' },
      });
    }, [isDark]);

    useEffect(() => {
      if (!candleRef.current || !volumeRef.current || !markersPluginRef.current || !primitiveRef.current) {
        return;
      }

      const candles: CandlestickData<Time>[] = data.bars.map((b) => ({
        time: b.date as Time,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      }));
      const vols: HistogramData<Time>[] = data.bars.map((b) => ({
        time: b.date as Time,
        value: b.volume,
        color:
          b.close >= b.open
            ? isDark
              ? 'rgba(16, 185, 129, 0.35)'
              : 'rgba(16, 185, 129, 0.4)'
            : isDark
              ? 'rgba(244, 63, 94, 0.35)'
              : 'rgba(244, 63, 94, 0.4)',
      }));

      candleRef.current.setData(candles);
      volumeRef.current.setData(vols);
      markersPluginRef.current.setMarkers(buildChartMarkers(data, overlays));
      primitiveRef.current.updateState({
        data,
        overlays,
        selectedSetup,
        dark: isDark,
      });
      chartRef.current?.timeScale().fitContent();
    }, [data, overlays, selectedSetup, isDark]);

    const displayBar = hoveredBar ?? data.bars[data.bars.length - 1] ?? null;

    return (
      <div className="relative rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        {displayBar && (
          <div className="px-3 py-1.5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono tabular-nums">
            <div className="flex flex-wrap items-center gap-3 text-slate-600 dark:text-slate-300">
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                {data.symbol} · {data.tf}
              </span>
              <span>{displayBar.date}</span>
              <span>O {formatNum(displayBar.open)}</span>
              <span>H {formatNum(displayBar.high)}</span>
              <span>L {formatNum(displayBar.low)}</span>
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                C {formatNum(displayBar.close)}
              </span>
              <span>Vol {displayBar.volume.toLocaleString('en-US')}</span>
              <span>ATR14 {formatNum(displayBar.atr14)}</span>
            </div>
            <div className="flex items-center gap-2">
              {displayBar.isUpperCircuit && (
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                  +10% Circuit Lock
                </span>
              )}
              {displayBar.isLowerCircuit && (
                <span className="text-rose-600 dark:text-rose-400 font-semibold">
                  -10% Circuit Lock
                </span>
              )}
              {displayBar.possibleCorpActionGap && (
                <span className="text-amber-600 dark:text-amber-400 font-semibold">
                  Corp-Action Gap Flagged
                </span>
              )}
            </div>
          </div>
        )}
        <div ref={containerRef} className="w-full" />
      </div>
    );
  }
);

AnalyzerChart.displayName = 'AnalyzerChart';
