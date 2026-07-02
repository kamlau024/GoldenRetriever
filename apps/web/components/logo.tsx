import { cn } from "@/lib/utils";

// Golden-retriever silhouette, vectorized (potrace) from the source artwork. The potrace
// transform maps the path coords into the 191×113 viewBox; fill uses currentColor so it themes.
const DOG_PATH =
  "M494 939 c-27 -11 -67 -19 -90 -19 -54 0 -56 -4 -31 -56 15 -31 35 -53 65 -70 42 -25 44 -28 38 -63 -12 -71 -16 -106 -10 -93 8 17 25 15 18 -3 -9 -22 6 -125 17 -125 5 0 9 10 9 23 0 13 9 1 24 -34 12 -31 36 -79 53 -105 57 -93 68 -190 28 -250 -21 -33 -20 -34 25 -34 38 0 40 1 40 33 0 17 5 48 11 67 5 19 14 60 19 90 5 30 21 91 35 135 l25 80 -3 -60 c-3 -33 -8 -68 -12 -79 -11 -26 52 -15 165 29 47 18 94 34 104 36 13 3 23 16 29 39 15 61 35 69 27 12 -8 -65 -4 -75 54 -115 88 -63 137 -140 140 -219 l1 -48 37 0 c41 0 41 6 3 79 -8 16 -21 65 -29 108 -7 43 -19 91 -25 106 -6 16 -11 54 -11 85 0 34 -8 74 -20 99 l-19 43 24 -16 c13 -8 26 -21 29 -29 9 -24 87 -75 114 -75 25 0 25 0 6 16 -21 17 -17 17 44 -1 25 -7 92 11 92 26 0 5 -11 4 -25 -1 -15 -6 -25 -6 -25 0 0 5 9 11 20 15 23 7 60 52 60 72 0 8 -4 11 -10 8 -5 -3 -10 2 -10 12 0 27 -27 61 -62 79 -38 20 -46 12 -19 -17 24 -26 26 -50 10 -82 -26 -49 -81 -50 -176 -3 -108 55 -178 69 -348 72 -82 2 -155 3 -162 3 -26 2 -81 63 -103 113 -20 46 -24 50 -30 32 -10 -26 -69 -76 -81 -68 -5 3 -8 24 -8 47 1 37 2 39 8 13 3 -17 9 -29 14 -28 4 1 11 2 17 2 12 0 40 54 40 78 0 47 -67 67 -136 41z M1040 389 c0 -6 27 -38 60 -71 64 -65 77 -97 67 -169 -5 -39 -4 -40 21 -37 15 2 26 8 25 13 -1 6 -5 45 -9 88 l-7 79 -50 39 c-62 50 -107 74 -107 58z M577 313 c6 -75 -6 -128 -39 -176 l-19 -27 29 0 c73 0 96 166 36 254 -11 16 -12 9 -7 -51z";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 191 113" role="img" aria-label="GoldenRetriever" className={cn("h-7 w-auto text-primary", className)}>
      <g transform="translate(0,113) scale(0.1,-0.1)" fill="currentColor">
        <path d={DOG_PATH} />
      </g>
    </svg>
  );
}

/** Golden-retriever head in profile, facing right — used as the assistant's chat avatar. */
export function DogAvatar({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" role="img" aria-label="GoldenRetriever" className={cn("text-primary", className)}>
      <g fill="currentColor">
        <path d="M13 16 C7 18 5 27 8 35 C9 40 15 40 16 33 C15 27 14 21 13 16Z" />
        <path d="M12 29 C9 22 11 13 20 12 C26 11 30 14 32 18 C35 20 40 21 43 24 C45 25 45 28 42 29 C39 30 37 29 35 30 C33 32 31 33 28 33 C24 34 20 33 18 31 C16 30 14 30 12 29Z" />
      </g>
      <circle cx="29" cy="19" r="1.4" fill="var(--background)" />
      <circle cx="43.5" cy="26" r="1.3" fill="#7a4a12" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <LogoMark />
      <span className="hidden text-foreground sm:inline">GoldenRetriever</span>
    </span>
  );
}
