import React from 'react';

interface MiniSparklineProps {
  values: number[];
  positive?: boolean;
  width?: number;
  height?: number;
}

export const MiniSparkline: React.FC<MiniSparklineProps> = ({
  values,
  positive = true,
  width = 76,
  height = 22,
}) => {
  if (!values || values.length < 2) {
    return <span className="text-[10px] text-slate-400 font-mono">–</span>;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const padY = 2;
  const innerH = height - padY * 2;
  const stepX = width / (values.length - 1);

  const points = values
    .map((v, i) => {
      const x = (i * stepX).toFixed(1);
      const y = (padY + innerH - ((v - min) / span) * innerH).toFixed(1);
      return `${x},${y}`;
    })
    .join(' ');

  const stroke = positive ? '#10b981' : '#ef4444';
  const lastY = (
    padY +
    innerH -
    ((values[values.length - 1] - min) / span) * innerH
  ).toFixed(1);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="inline-block overflow-visible shrink-0"
      aria-hidden="true"
    >
      <polyline
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
      <circle cx={width} cy={lastY} r="2" fill={stroke} />
    </svg>
  );
};
