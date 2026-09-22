import { GAME_TITLE } from "@manhunter/core";
import { DispatchScreen } from "./dispatchscreen";

export const App = () => (
  <main className="mh-app">
    <h1 className="mh-app__title">{GAME_TITLE}</h1>
    <DispatchScreen />
  </main>
);
