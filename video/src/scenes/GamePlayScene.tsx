import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion";

interface QuestionData {
  question: string;
  choices: string[];
  correct: number;
}

const questions: QuestionData[] = [
  {
    question: "What is Eleven's real name?",
    choices: ["Jane Hopper", "Jane Wheeler", "Elle Brenner", "Sara Hopper"],
    correct: 0,
  },
  {
    question: "Which dimension do the monsters come from?",
    choices: ["The Shadow Realm", "The Upside Down", "The Void", "The Dark World"],
    correct: 1,
  },
  {
    question: "Which song saves Max from Vecna?",
    choices: ["Thriller", "Running Up That Hill", "Should I Stay", "Hounds of Love"],
    correct: 1,
  },
];

const choiceColors = ["#e21b3c", "#1368ce", "#d89e00", "#26890c"];
const choiceShapes = ["triangle", "diamond", "circle", "square"];

export const GamePlayScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const fadeIn = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: "clamp" });
  const fadeOut = interpolate(frame, [185, 210], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // Each question gets ~70 frames
  const questionIndex = Math.min(Math.floor(frame / 70), questions.length - 1);
  const questionFrame = frame - questionIndex * 70;
  const q = questions[questionIndex];

  // Timer countdown
  const timerMax = 20;
  const timer = Math.max(0, timerMax - Math.floor(questionFrame / 3));

  // Answer reveal at frame 50 of each question
  const showAnswer = questionFrame > 50;
  const answerProgress = interpolate(questionFrame, [50, 58], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Question transition
  const qFadeIn = interpolate(questionFrame, [0, 12], [0, 1], { extrapolateRight: "clamp" });
  const qSlideIn = interpolate(questionFrame, [0, 12], [30, 0], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        opacity: fadeIn * fadeOut,
        background: "#7c3aed",
      }}
    >
      {/* Question number */}
      <div
        style={{
          position: "absolute",
          top: 40,
          left: 60,
          fontFamily: "'Inter', system-ui, sans-serif",
          fontSize: 18,
          fontWeight: 700,
          color: "rgba(255,255,255,0.7)",
        }}
      >
        {questionIndex + 1} of 10
      </div>

      {/* Timer */}
      <div
        style={{
          position: "absolute",
          top: 30,
          right: 60,
          width: 70,
          height: 70,
          borderRadius: "50%",
          background: "rgba(255,255,255,0.15)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "'Inter', system-ui, sans-serif",
          fontSize: 28,
          fontWeight: 800,
          color: timer <= 5 ? "#fca5a5" : "#fff",
        }}
      >
        {timer}
      </div>

      {/* Score bar */}
      <div
        style={{
          position: "absolute",
          top: 50,
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          gap: 24,
          fontFamily: "'Inter', system-ui, sans-serif",
          fontSize: 14,
          color: "rgba(255,255,255,0.6)",
        }}
      >
        <span>MikeW_11: {1200 + questionIndex * 800}</span>
        <span>DustinH: {1000 + questionIndex * 650}</span>
        <span>ElHopper: {900 + questionIndex * 720}</span>
      </div>

      <div
        style={{
          width: "100%",
          maxWidth: 1200,
          padding: "0 60px",
          opacity: qFadeIn,
          transform: `translateY(${qSlideIn}px)`,
        }}
      >
        {/* Question */}
        <div
          style={{
            textAlign: "center",
            marginBottom: 50,
            padding: "40px 60px",
            background: "rgba(0,0,0,0.2)",
            borderRadius: 12,
          }}
        >
          <h2
            style={{
              fontFamily: "'Inter', system-ui, sans-serif",
              fontSize: 38,
              fontWeight: 800,
              color: "#fff",
              margin: 0,
            }}
          >
            {q.question}
          </h2>
        </div>

        {/* Answer grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
          }}
        >
          {q.choices.map((choice, i) => {
            const choiceDelay = 10 + i * 4;
            const choiceOpacity = interpolate(questionFrame, [choiceDelay, choiceDelay + 8], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });

            const isCorrect = i === q.correct;

            let bg = choiceColors[i];
            let opacity = choiceOpacity;
            if (showAnswer) {
              if (isCorrect) {
                bg = choiceColors[i];
                opacity = 1;
              } else {
                opacity = choiceOpacity * (1 - answerProgress * 0.6);
              }
            }

            return (
              <div
                key={i}
                style={{
                  padding: "22px 30px",
                  borderRadius: 10,
                  background: bg,
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  opacity,
                  transform: isCorrect && showAnswer ? `scale(${1 + answerProgress * 0.04})` : "scale(1)",
                  boxShadow: isCorrect && showAnswer ? "0 0 30px rgba(255,255,255,0.2)" : "none",
                  transition: "none",
                }}
              >
                {/* Shape icon */}
                <div style={{ width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {choiceShapes[i] === "triangle" && (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
                      <polygon points="12,2 22,20 2,20" />
                    </svg>
                  )}
                  {choiceShapes[i] === "diamond" && (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
                      <polygon points="12,2 22,12 12,22 2,12" />
                    </svg>
                  )}
                  {choiceShapes[i] === "circle" && (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
                      <circle cx="12" cy="12" r="10" />
                    </svg>
                  )}
                  {choiceShapes[i] === "square" && (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
                      <rect x="2" y="2" width="20" height="20" />
                    </svg>
                  )}
                </div>
                <span
                  style={{
                    fontFamily: "'Inter', system-ui, sans-serif",
                    fontSize: 22,
                    fontWeight: 700,
                    color: "#fff",
                  }}
                >
                  {choice}
                </span>

                {/* Checkmark for correct answer */}
                {isCorrect && showAnswer && (
                  <svg
                    width="28"
                    height="28"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="white"
                    strokeWidth="3"
                    strokeLinecap="round"
                    style={{
                      marginLeft: "auto",
                      opacity: answerProgress,
                    }}
                  >
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};
