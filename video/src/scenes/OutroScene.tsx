import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion";

export const OutroScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const fadeIn = interpolate(frame, [0, 25], [0, 1], { extrapolateRight: "clamp" });
  const logoScale = spring({ frame: frame - 10, fps, config: { damping: 10, stiffness: 80 } });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        opacity: fadeIn,
      }}
    >
      {/* Gradient glow */}
      <div
        style={{
          position: "absolute",
          width: 600,
          height: 600,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(255,107,74,0.12) 0%, transparent 70%)",
          filter: "blur(60px)",
        }}
      />

      <div style={{ textAlign: "center", zIndex: 1 }}>
        {/* Logo */}
        <div
          style={{
            width: 80,
            height: 80,
            borderRadius: 20,
            background: "linear-gradient(135deg, #ff6b4a, #ffb347)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 40px",
            fontSize: 36,
            fontWeight: 800,
            color: "#06080d",
            fontFamily: "system-ui, sans-serif",
            transform: `scale(${Math.min(logoScale, 1)})`,
          }}
        >
          E
        </div>

        <h1
          style={{
            fontFamily: "Georgia, serif",
            fontSize: 56,
            fontWeight: 400,
            color: "#e8eaf0",
            margin: "0 0 16px",
            opacity: interpolate(frame, [15, 35], [0, 1], { extrapolateRight: "clamp" }),
          }}
        >
          Claude Edu Plugins
        </h1>

        <p
          style={{
            fontFamily: "system-ui, sans-serif",
            fontSize: 24,
            color: "#8a90a2",
            fontWeight: 300,
            marginBottom: 40,
            opacity: interpolate(frame, [25, 45], [0, 1], { extrapolateRight: "clamp" }),
          }}
        >
          AI-powered education tools for Moodle &amp; Kahoot
        </p>

        {/* GitHub link */}
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 12,
            padding: "14px 32px",
            borderRadius: 10,
            background: "rgba(255,107,74,0.1)",
            border: "1px solid rgba(255,107,74,0.25)",
            fontFamily: "monospace",
            fontSize: 18,
            color: "#ff6b4a",
            opacity: interpolate(frame, [35, 55], [0, 1], { extrapolateRight: "clamp" }),
            transform: `translateY(${interpolate(frame, [35, 55], [15, 0], { extrapolateRight: "clamp" })}px)`,
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="#ff6b4a">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
          </svg>
          github.com/rudini/claude-edu-plugins
        </div>

        {/* Install command */}
        <div
          style={{
            marginTop: 20,
            fontFamily: "monospace",
            fontSize: 16,
            color: "#555b6e",
            opacity: interpolate(frame, [45, 65], [0, 1], { extrapolateRight: "clamp" }),
          }}
        >
          /plugin marketplace add rudini/claude-edu-plugins
        </div>
      </div>
    </AbsoluteFill>
  );
};
