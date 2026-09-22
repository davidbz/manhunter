import { GAME_TITLE } from "@manhunter/core";
import { DispatchScreen } from "./dispatchscreen";

export const App = () => (
  <main>
    <h1>{GAME_TITLE}</h1>
    <DispatchScreen />
  </main>
);
