import type { ProjectIconColor } from "@t3tools/contracts";
import { isCjkMonogram } from "@t3tools/shared/projectMonogram";
import { projectIconColorClassName } from "../projectIconColors";
import { cn } from "~/lib/utils";

const monogramSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function ProjectMonogram({
  text,
  color,
  className,
}: {
  readonly text: string;
  readonly color: ProjectIconColor;
  readonly className?: string | undefined;
}) {
  const glyphCount = Math.max(1, Array.from(monogramSegmenter.segment(text)).length);
  const hasCjk = isCjkMonogram(text);
  // Adaptive viewBox width so 2-4 Chinese chars or 3-char acronyms never get squished.
  const viewWidth = hasCjk
    ? glyphCount <= 1
      ? 16
      : glyphCount === 2
        ? 24
        : glyphCount === 3
          ? 34
          : 44
    : glyphCount <= 2
      ? 18
      : glyphCount === 3
        ? 24
        : 30;
  const fontSize = hasCjk ? (glyphCount <= 1 ? 10.2 : 9.4) : glyphCount <= 2 ? 9.2 : 8.5;
  const baselineY = hasCjk ? 11.4 : 11.1;
  const isWide = viewWidth > 18;

  return (
    <span
      aria-hidden="true"
      data-slot="project-monogram"
      className={cn(
        "inline-flex h-4 shrink-0 items-center justify-center",
        isWide ? "w-auto" : "size-4",
        className,
        isWide && "w-auto",
      )}
    >
      <svg
        viewBox={`0 0 ${viewWidth} 16`}
        className={cn(
          "h-full w-auto overflow-hidden rounded-sm select-none",
          hasCjk ? "font-sans" : "font-mono",
          projectIconColorClassName(color),
        )}
        style={{
          backgroundColor: "color-mix(in srgb, currentColor 16%, transparent)",
          boxShadow: "inset 0 0 0 1px color-mix(in srgb, currentColor 24%, transparent)",
        }}
      >
        <text
          x={viewWidth / 2}
          y={baselineY}
          textAnchor="middle"
          fill="currentColor"
          className={hasCjk ? "font-sans" : "font-mono"}
          fontSize={fontSize}
          fontWeight={hasCjk ? "600" : "700"}
          textRendering="geometricPrecision"
        >
          {text}
        </text>
      </svg>
    </span>
  );
}
