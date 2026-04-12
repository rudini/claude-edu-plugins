import { AbsoluteFill, Sequence, useCurrentFrame, interpolate } from "remotion";
import { IntroScene } from "./scenes/IntroScene";
import { TerminalScene } from "./scenes/TerminalScene";
import { QuizCreatedScene } from "./scenes/QuizCreatedScene";
import { GameLobbyScene } from "./scenes/GameLobbyScene";
import { GamePlayScene } from "./scenes/GamePlayScene";
import { OutroScene } from "./scenes/OutroScene";

export const KahootDemo: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{ background: "#ffffff" }}>
      {/* Animated background gradient */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse at ${50 + Math.sin(frame / 60) * 10}% ${50 + Math.cos(frame / 80) * 10}%, rgba(37,99,235,0.06) 0%, transparent 50%),
                       radial-gradient(ellipse at ${30 + Math.cos(frame / 70) * 15}% ${70 + Math.sin(frame / 50) * 10}%, rgba(124,58,237,0.04) 0%, transparent 50%),
                       #ffffff`,
        }}
      />

      {/* Scene 1: Intro — frames 0-120 (4s) */}
      <Sequence from={0} durationInFrames={120}>
        <IntroScene />
      </Sequence>

      {/* Scene 2: Terminal creating quiz — frames 100-400 (10s) */}
      <Sequence from={100} durationInFrames={300}>
        <TerminalScene />
      </Sequence>

      {/* Scene 3: Quiz created confirmation — frames 380-520 (4.7s) */}
      <Sequence from={380} durationInFrames={140}>
        <QuizCreatedScene />
      </Sequence>

      {/* Scene 4: Game lobby — frames 500-620 (4s) */}
      <Sequence from={500} durationInFrames={120}>
        <GameLobbyScene />
      </Sequence>

      {/* Scene 5: Gameplay — frames 600-810 (7s) */}
      <Sequence from={600} durationInFrames={210}>
        <GamePlayScene />
      </Sequence>

      {/* Scene 6: Outro — frames 790-900 (3.7s) */}
      <Sequence from={790} durationInFrames={110}>
        <OutroScene />
      </Sequence>
    </AbsoluteFill>
  );
};
