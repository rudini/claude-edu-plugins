import { Composition } from "remotion";
import { KahootDemo } from "./KahootDemo";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="KahootDemo"
      component={KahootDemo}
      durationInFrames={900}
      fps={30}
      width={1920}
      height={1080}
    />
  );
};
