type SquirrelMascotMode = "idle" | "thinking" | "working";

type SquirrelMascotProps = {
  mode?: SquirrelMascotMode;
  size?: number;
  className?: string;
};

export function SquirrelMascot({ mode = "idle", size = 18, className }: SquirrelMascotProps) {
  return (
    <span className={["ca-squirrel-mascot", `ca-squirrel-mascot-${mode}`, className].filter(Boolean).join(" ")}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 512 512"
        aria-hidden="true"
        focusable="false"
        className="ca-squirrel-mascot-svg"
      >
        <circle cx="256" cy="256" r="240" fill="#9FD6E3" />
        <ellipse cx="256" cy="455" rx="130" ry="25" fill="#7FBAC9" opacity="0.5" />

        <g className="ca-squirrel-mascot-bob">
          <path
            className="ca-squirrel-mascot-tail"
            d="M280 430 C 380 420, 460 320, 460 220 C 460 120, 350 80, 280 160 C 320 180, 350 230, 350 280 C 350 340, 310 390, 280 430 Z"
            fill="#E89A5E"
            stroke="#4A3222"
            strokeWidth="8"
            strokeLinejoin="round"
          />
          <path
            d="M170 150 C 160 110, 180 90, 200 100 C 220 110, 200 130, 190 150 Z"
            fill="#E89A5E"
            stroke="#4A3222"
            strokeWidth="8"
            strokeLinejoin="round"
          />

          <ellipse cx="180" cy="350" rx="25" ry="15" fill="#E89A5E" stroke="#4A3222" strokeWidth="8" />

          <path
            d="M150 450 C 110 450, 110 350, 130 270 C 150 170, 200 140, 260 140 C 320 140, 370 170, 390 270 C 410 370, 350 450, 260 450 Z"
            fill="#E89A5E"
            stroke="#4A3222"
            strokeWidth="8"
            strokeLinejoin="round"
          />

          <path
            d="M175 450 C 175 400, 250 380, 250 320 C 250 260, 210 240, 180 240 C 160 240, 140 260, 135 280 C 130 350, 140 420, 175 450 Z"
            fill="#FBE8C9"
          />

          <path
            d="M450 230 C 450 170, 400 140, 360 160 C 380 190, 400 220, 400 250 C 400 290, 370 320, 345 340 C 385 340, 450 300, 450 230 Z"
            fill="#FBE8C9"
          />
          <path
            d="M365 170 C 395 190, 410 220, 410 250 C 410 280, 390 310, 360 330"
            stroke="#4A3222"
            strokeWidth="6"
            strokeLinecap="round"
            fill="none"
          />

          <path
            d="M330 150 C 340 110, 320 90, 300 100 C 280 110, 300 130, 310 150 Z"
            fill="#E89A5E"
            stroke="#4A3222"
            strokeWidth="8"
            strokeLinejoin="round"
          />
          <path d="M185 145 C 185 125, 195 115, 205 125" stroke="#4A3222" strokeWidth="4" strokeLinecap="round" fill="none" />
          <path d="M315 145 C 315 125, 305 115, 295 125" stroke="#4A3222" strokeWidth="4" strokeLinecap="round" fill="none" />

          <g className="ca-squirrel-mascot-acorn">
            <g transform="rotate(-25 210 360)">
              <ellipse cx="210" cy="360" rx="65" ry="75" fill="#DDB483" stroke="#4A3222" strokeWidth="8" />
              <path
                d="M150 310 C 150 260, 270 260, 270 310 C 270 345, 150 345, 150 310 Z"
                fill="#7A5C43"
                stroke="#4A3222"
                strokeWidth="8"
              />
              <path d="M210 270 L 210 245" stroke="#4A3222" strokeWidth="10" strokeLinecap="round" />

              <g stroke="#4A3222" strokeWidth="4" opacity="0.6">
                <path d="M170 285 L 180 335" />
                <path d="M195 280 L 205 340" />
                <path d="M220 280 L 230 340" />
                <path d="M245 285 L 255 335" />
                <path d="M160 305 L 260 295" />
                <path d="M165 325 L 265 315" />
              </g>
            </g>
          </g>

          <ellipse cx="290" cy="340" rx="30" ry="20" fill="#E89A5E" stroke="#4A3222" strokeWidth="8" />

          <path d="M370 350 C 370 410, 330 450, 270 450" stroke="#4A3222" strokeWidth="8" strokeLinecap="round" fill="none" />
          <path d="M160 450 C 150 460, 180 465, 190 455" stroke="#4A3222" strokeWidth="8" strokeLinecap="round" fill="none" />
          <path d="M270 450 C 260 460, 290 465, 300 455" stroke="#4A3222" strokeWidth="8" strokeLinecap="round" fill="none" />

          <g>
            <ellipse cx="150" cy="255" rx="18" ry="10" fill="#F78FA7" opacity="0.6" />
            <ellipse cx="260" cy="255" rx="18" ry="10" fill="#F78FA7" opacity="0.6" />

            <ellipse cx="170" cy="225" rx="14" ry="18" fill="#333333" />
            <circle cx="164" cy="218" r="6" fill="#FFFFFF" />
            <ellipse cx="240" cy="225" rx="14" ry="18" fill="#333333" />
            <circle cx="234" cy="218" r="6" fill="#FFFFFF" />

            <path
              d="M195 255 C 195 245, 215 245, 215 255 C 215 265, 195 265, 195 255 Z"
              fill="#333333"
            />
            <path d="M205 265 L 205 275" stroke="#333333" strokeWidth="4" strokeLinecap="round" />
            <path
              d="M195 275 C 195 285, 215 285, 215 275"
              stroke="#333333"
              strokeWidth="4"
              strokeLinecap="round"
              fill="none"
            />
            <rect x="200" y="275" width="10" height="8" fill="#FFFFFF" stroke="#333333" strokeWidth="2" />
          </g>
        </g>
      </svg>
    </span>
  );
}
