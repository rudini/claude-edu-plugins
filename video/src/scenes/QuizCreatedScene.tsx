import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion";

export const QuizCreatedScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const fadeIn = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: "clamp" });
  const fadeOut = interpolate(frame, [110, 140], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const checkScale = spring({ frame: frame - 15, fps, config: { damping: 8, stiffness: 100 } });
  const cardScale = spring({ frame: frame - 5, fps, config: { damping: 15, stiffness: 60 } });

  const questions = [
    "What is Eleven's real name?",
    "Which dimension do the monsters come from?",
    "What game do the boys play in Mike's basement?",
    "What is the name of the sheriff?",
    "Which song does Max use to escape Vecna?",
    "What flavor of Eggos does Eleven prefer?",
    "What is the name of the secret lab?",
    "Who is the Mind Flayer?",
    "What year does Stranger Things begin?",
    "What is the Upside Down?",
  ];

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        opacity: fadeIn * fadeOut,
      }}
    >
      <div style={{ display: "flex", gap: 60, alignItems: "center", padding: "0 100px" }}>
        {/* Left: success card */}
        <div
          style={{
            flex: 1,
            textAlign: "center",
            transform: `scale(${Math.min(cardScale, 1)})`,
          }}
        >
          {/* Checkmark */}
          <div
            style={{
              width: 120,
              height: 120,
              borderRadius: "50%",
              background: "rgba(79, 209, 197, 0.1)",
              border: "2px solid rgba(79, 209, 197, 0.3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 30px",
              transform: `scale(${Math.min(checkScale, 1)})`,
            }}
          >
            <svg
              width="60"
              height="60"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#4fd1c5"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </div>

          <h2
            style={{
              fontFamily: "Georgia, serif",
              fontSize: 48,
              color: "#e8eaf0",
              margin: "0 0 16px",
              fontWeight: 400,
            }}
          >
            Quiz Created!
          </h2>
          <p
            style={{
              fontFamily: "system-ui, sans-serif",
              fontSize: 22,
              color: "#8a90a2",
              fontWeight: 300,
            }}
          >
            10 questions ready to play
          </p>
        </div>

        {/* Right: question list */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {questions.map((q, i) => {
            const qDelay = 20 + i * 5;
            const qOpacity = interpolate(frame, [qDelay, qDelay + 8], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            const qSlide = interpolate(frame, [qDelay, qDelay + 8], [20, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });

            return (
              <div
                key={i}
                style={{
                  padding: "14px 20px",
                  borderRadius: 10,
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  opacity: qOpacity,
                  transform: `translateX(${qSlide}px)`,
                }}
              >
                <span
                  style={{
                    fontFamily: "monospace",
                    fontSize: 13,
                    color: "#ff6b4a",
                    fontWeight: 600,
                    width: 28,
                    textAlign: "right",
                  }}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span
                  style={{
                    fontFamily: "system-ui, sans-serif",
                    fontSize: 17,
                    color: "#8a90a2",
                    fontWeight: 300,
                  }}
                >
                  {q}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};
