import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion";

export const IntroScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleScale = spring({ frame, fps, config: { damping: 12, stiffness: 80 } });
  const titleOpacity = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: "clamp" });
  const subtitleOpacity = interpolate(frame, [25, 45], [0, 1], { extrapolateRight: "clamp" });
  const subtitleY = interpolate(frame, [25, 45], [30, 0], { extrapolateRight: "clamp" });
  const badgeOpacity = interpolate(frame, [50, 65], [0, 1], { extrapolateRight: "clamp" });
  const fadeOut = interpolate(frame, [95, 120], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        opacity: fadeOut,
      }}
    >
      {/* Decorative rings */}
      <div
        style={{
          position: "absolute",
          width: 500,
          height: 500,
          borderRadius: "50%",
          border: "1px solid rgba(255,107,74,0.1)",
          transform: `scale(${1 + frame * 0.008}) rotate(${frame * 0.3}deg)`,
          opacity: interpolate(frame, [0, 30, 100], [0, 0.5, 0]),
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 700,
          height: 700,
          borderRadius: "50%",
          border: "1px solid rgba(134,76,191,0.08)",
          transform: `scale(${1 + frame * 0.005}) rotate(${-frame * 0.2}deg)`,
          opacity: interpolate(frame, [10, 40, 100], [0, 0.4, 0]),
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
            transform: `scale(${titleScale})`,
            opacity: titleOpacity,
          }}
        >
          E
        </div>

        {/* Title */}
        <h1
          style={{
            fontFamily: "Georgia, serif",
            fontSize: 72,
            fontWeight: 400,
            color: "#e8eaf0",
            margin: 0,
            letterSpacing: -1,
            transform: `scale(${titleScale})`,
            opacity: titleOpacity,
          }}
        >
          Claude Edu Plugins
        </h1>

        {/* Subtitle */}
        <p
          style={{
            fontFamily: "system-ui, sans-serif",
            fontSize: 28,
            color: "#8a90a2",
            marginTop: 20,
            fontWeight: 300,
            opacity: subtitleOpacity,
            transform: `translateY(${subtitleY}px)`,
          }}
        >
          Creating a Kahoot Quiz with AI
        </p>

        {/* Badge */}
        <div
          style={{
            marginTop: 40,
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 24px",
            borderRadius: 100,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.1)",
            fontFamily: "monospace",
            fontSize: 16,
            color: "#4fd1c5",
            opacity: badgeOpacity,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#4fd1c5",
              boxShadow: "0 0 10px #4fd1c5",
            }}
          />
          Stranger Things Edition
        </div>
      </div>
    </AbsoluteFill>
  );
};
