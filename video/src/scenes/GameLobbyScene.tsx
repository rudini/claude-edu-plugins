import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion";

export const GameLobbyScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const fadeIn = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: "clamp" });
  const fadeOut = interpolate(frame, [95, 120], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const pinScale = spring({ frame: frame - 15, fps, config: { damping: 10, stiffness: 80 } });

  const players = ["MikeW_11", "DustinH", "LucasS", "MaxM_85", "WillB", "ElHopper"];

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        opacity: fadeIn * fadeOut,
        background: "linear-gradient(180deg, #ede9fe 0%, #ffffff 100%)",
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
          color: "#7c3aed",
          opacity: interpolate(frame, [0, 30], [0, 0.7], { extrapolateRight: "clamp" }),
        }}
      >
        Step 2 &mdash; Start the Game
      </div>

      {/* Kahoot-style lobby */}
      <div style={{ textAlign: "center" }}>
        {/* Game PIN */}
        <div
          style={{
            marginBottom: 20,
            fontFamily: "'Inter', system-ui, sans-serif",
            fontSize: 18,
            color: "#6b7280",
            letterSpacing: 2,
            textTransform: "uppercase",
            fontWeight: 600,
            opacity: interpolate(frame, [10, 25], [0, 1], { extrapolateRight: "clamp" }),
          }}
        >
          Game PIN
        </div>
        <div
          style={{
            fontFamily: "'Inter', system-ui, sans-serif",
            fontSize: 96,
            fontWeight: 800,
            color: "#111827",
            letterSpacing: 12,
            marginBottom: 50,
            transform: `scale(${Math.min(pinScale, 1)})`,
          }}
        >
          4 8 2 7 3 1
        </div>

        {/* Title */}
        <div
          style={{
            fontFamily: "'Inter', system-ui, sans-serif",
            fontSize: 36,
            fontWeight: 600,
            color: "#111827",
            marginBottom: 50,
            opacity: interpolate(frame, [20, 35], [0, 1], { extrapolateRight: "clamp" }),
          }}
        >
          Stranger Things Ultimate Quiz
        </div>

        {/* Players joining */}
        <div style={{ display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" }}>
          {players.map((name, i) => {
            const pDelay = 30 + i * 10;
            const pOpacity = interpolate(frame, [pDelay, pDelay + 8], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            const pScale = spring({
              frame: frame - pDelay,
              fps,
              config: { damping: 10, stiffness: 120 },
            });

            const colors = ["#2563eb", "#7c3aed", "#059669", "#ea580c", "#0891b2", "#e11d48"];

            return (
              <div
                key={i}
                style={{
                  padding: "12px 24px",
                  borderRadius: 12,
                  background: `${colors[i]}10`,
                  border: `1px solid ${colors[i]}30`,
                  fontFamily: "'Inter', system-ui, sans-serif",
                  fontSize: 18,
                  fontWeight: 600,
                  color: colors[i],
                  opacity: Math.max(0, pOpacity),
                  transform: `scale(${Math.min(Math.max(pScale, 0), 1.05)})`,
                }}
              >
                {name}
              </div>
            );
          })}
        </div>

        {/* Player count */}
        <div
          style={{
            marginTop: 40,
            fontFamily: "'Inter', system-ui, sans-serif",
            fontSize: 20,
            color: "#9ca3af",
            opacity: interpolate(frame, [85, 95], [0, 1], { extrapolateRight: "clamp" }),
          }}
        >
          {players.length} players joined
        </div>
      </div>
    </AbsoluteFill>
  );
};
