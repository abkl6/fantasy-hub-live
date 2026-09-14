/** Thin single-line sparkline. Values are 0-1 fractions. */
export function Sparkline({
  values,
  color = "var(--primary)",
  height = 24,
  width = 120,
  label,
}: {
  values: number[];
  color?: string;
  height?: number;
  width?: number;
  label?: string;
}) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 0.001);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - ((v - min) / span) * (height - 2) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={label ?? "trend"}
      className="overflow-visible"
      preserveAspectRatio="none"
    >
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
