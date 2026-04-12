import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion";

interface TerminalLine {
  type: "prompt" | "output" | "success" | "blank" | "json";
  text?: string;
  delay: number; // frame to appear
}

const lines: TerminalLine[] = [
  { type: "prompt", text: '$ /kahoot-skill:kahoot create stranger-things-quiz.json', delay: 20 },
  { type: "blank", delay: 50 },
  { type: "output", text: "Reading quiz definition...", delay: 55 },
  { type: "blank", delay: 70 },
  { type: "json", text: '{', delay: 80 },
  { type: "json", text: '  "title": "Stranger Things Ultimate Quiz",', delay: 85 },
  { type: "json", text: '  "questions": [', delay: 90 },
  { type: "json", text: '    {', delay: 95 },
  { type: "json", text: '      "question": "What is Eleven\'s real name?",', delay: 100 },
  { type: "json", text: '      "choices": [', delay: 105 },
  { type: "json", text: '        { "answer": "Jane Hopper", "correct": true },', delay: 108 },
  { type: "json", text: '        { "answer": "Jane Wheeler", "correct": false },', delay: 111 },
  { type: "json", text: '        { "answer": "Elle Brenner", "correct": false },', delay: 114 },
  { type: "json", text: '        { "answer": "Sara Hopper", "correct": false }', delay: 117 },
  { type: "json", text: '      ]', delay: 120 },
  { type: "json", text: '    },', delay: 123 },
  { type: "json", text: '    ... 9 more questions', delay: 128 },
  { type: "json", text: '  ]', delay: 133 },
  { type: "json", text: '}', delay: 136 },
  { type: "blank", delay: 145 },
  { type: "success", text: "✓ Validated 10 questions (dry-run)", delay: 150 },
  { type: "output", text: '  Add --live to create on Kahoot', delay: 158 },
  { type: "blank", delay: 175 },
  { type: "prompt", text: '$ /kahoot-skill:kahoot create stranger-things-quiz.json --live', delay: 185 },
  { type: "blank", delay: 215 },
  { type: "output", text: "Creating quiz on Kahoot...", delay: 220 },
  { type: "output", text: "Uploading 10 questions...", delay: 235 },
  { type: "success", text: '✓ Quiz created: "Stranger Things Ultimate Quiz"', delay: 255 },
  { type: "success", text: "  ID: 8f3a2b1c-4d5e-6f7g-8h9i-0j1k2l3m4n5o", delay: 262 },
  { type: "success", text: "  URL: https://create.kahoot.it/details/8f3a2b1c", delay: 269 },
];

export const TerminalScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const fadeIn = interpolate(frame, [0, 25], [0, 1], { extrapolateRight: "clamp" });
  const slideUp = interpolate(frame, [0, 25], [40, 0], { extrapolateRight: "clamp" });
  const fadeOut = interpolate(frame, [270, 300], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const terminalScale = spring({ frame: frame - 5, fps, config: { damping: 15, stiffness: 60 } });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        padding: 80,
        opacity: fadeIn * fadeOut,
        transform: `translateY(${slideUp}px)`,
      }}
    >
      {/* Scene label */}
      <div
        style={{
          position: "absolute",
          top: 60,
          left: 100,
          fontFamily: "'Inter', system-ui, sans-serif",
          fontSize: 14,
          letterSpacing: 3,
          textTransform: "uppercase",
          fontWeight: 600,
          color: "#2563eb",
          opacity: interpolate(frame, [0, 30], [0, 0.7], { extrapolateRight: "clamp" }),
        }}
      >
        Step 1 &mdash; Create the Quiz
      </div>

      {/* Terminal window */}
      <div
        style={{
          width: "100%",
          maxWidth: 1400,
          borderRadius: 16,
          overflow: "hidden",
          background: "#1e293b",
          border: "1px solid #334155",
          boxShadow: "0 25px 80px rgba(0,0,0,0.15)",
          transform: `scale(${Math.min(terminalScale, 1)})`,
        }}
      >
        {/* Title bar */}
        <div
          style={{
            padding: "14px 20px",
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "#0f172a",
            borderBottom: "1px solid #334155",
          }}
        >
          <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#ff5f57" }} />
          <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#febc2e" }} />
          <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#28c840" }} />
          <span
            style={{
              flex: 1,
              textAlign: "center",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 13,
              color: "#64748b",
            }}
          >
            claude-code &mdash; kahoot-skill
          </span>
        </div>

        {/* Terminal body */}
        <div style={{ padding: "24px 28px", minHeight: 500 }}>
          {lines.map((line, i) => {
            const lineOpacity = interpolate(
              frame,
              [line.delay, line.delay + 6],
              [0, 1],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
            );
            const lineSlide = interpolate(
              frame,
              [line.delay, line.delay + 6],
              [8, 0],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
            );

            if (line.type === "blank") {
              return <div key={i} style={{ height: 8, opacity: lineOpacity }} />;
            }

            const colorMap: Record<string, string> = {
              prompt: "#38bdf8",
              output: "#64748b",
              success: "#22c55e",
              json: "#94a3b8",
            };

            let rendered = line.text || "";
            let parts: React.ReactNode[] = [rendered];

            if (line.type === "prompt") {
              const dollarEnd = 2;
              // Typing effect for prompt
              const charsToShow = Math.floor(
                interpolate(
                  frame,
                  [line.delay, line.delay + rendered.length * 0.6],
                  [0, rendered.length - dollarEnd],
                  { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
                )
              );
              parts = [
                <span key="dollar" style={{ color: "#38bdf8" }}>$ </span>,
                <span key="cmd" style={{ color: "#e2e8f0" }}>
                  {rendered.slice(dollarEnd, dollarEnd + charsToShow)}
                </span>,
                // Cursor
                charsToShow < rendered.length - dollarEnd ? (
                  <span
                    key="cursor"
                    style={{
                      display: "inline-block",
                      width: 10,
                      height: 20,
                      background: "#38bdf8",
                      marginLeft: 2,
                      opacity: Math.sin(frame * 0.3) > 0 ? 1 : 0,
                      verticalAlign: "middle",
                    }}
                  />
                ) : null,
              ];
            }

            if (line.type === "json") {
              // Syntax highlight JSON
              const highlighted = rendered
                .replace(/"([^"]+)":/g, '<key>"$1"</key>:')
                .replace(/: "([^"]+)"/g, ': <str>"$1"</str>')
                .replace(/: (true|false)/g, ': <bool>$1</bool>');

              parts = [
                <span
                  key="json"
                  dangerouslySetInnerHTML={{
                    __html: highlighted
                      .replace(/<key>/g, '<span style="color:#93c5fd">')
                      .replace(/<\/key>/g, "</span>")
                      .replace(/<str>/g, '<span style="color:#fbbf24">')
                      .replace(/<\/str>/g, "</span>")
                      .replace(/<bool>/g, '<span style="color:#22c55e">')
                      .replace(/<\/bool>/g, "</span>"),
                  }}
                />,
              ];
            }

            if (line.type === "success") {
              parts = [<span key="s" style={{ color: "#22c55e" }}>{rendered}</span>];
            }

            // Highlight --live flag
            if (rendered.includes("--live")) {
              const flagStyle = {
                color: "#fbbf24",
                fontWeight: 700 as const,
              };
              if (line.type === "prompt") {
                const cmdText = rendered.slice(2);
                const charsToShow2 = Math.floor(
                  interpolate(
                    frame,
                    [line.delay, line.delay + rendered.length * 0.6],
                    [0, cmdText.length],
                    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
                  )
                );
                const shown = cmdText.slice(0, charsToShow2);
                const liveIdx = shown.indexOf("--live");
                parts = [
                  <span key="dollar" style={{ color: "#38bdf8" }}>$ </span>,
                  liveIdx >= 0 ? (
                    <span key="cmd" style={{ color: "#e2e8f0" }}>
                      {shown.slice(0, liveIdx)}
                      <span style={flagStyle}>--live</span>
                      {shown.slice(liveIdx + 6)}
                    </span>
                  ) : (
                    <span key="cmd" style={{ color: "#e2e8f0" }}>{shown}</span>
                  ),
                ];
              }
            }

            return (
              <div
                key={i}
                style={{
                  fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
                  fontSize: 16,
                  lineHeight: 1.9,
                  color: colorMap[line.type] || "#94a3b8",
                  opacity: lineOpacity,
                  transform: `translateY(${lineSlide}px)`,
                  whiteSpace: "pre",
                }}
              >
                {parts}
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};
