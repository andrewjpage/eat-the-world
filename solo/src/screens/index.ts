import { createElement, lazy, type JSXElementConstructor, type ReactElement } from "react";
import type { Route, RouteName, ScreenProps } from "@solo/router";
import NotFound from "./NotFound";
import Passport from "./Passport";

type Screen = JSXElementConstructor<ScreenProps>;
type LazyRoute = Exclude<RouteName, "passport" | "not-found">;

/** Everything but the home screen loads on demand, so the first paint carries only the passport. */
const loaders: Record<LazyRoute, () => Promise<{ default: Screen }>> = {
  map: () => import("./MapScreen"),
  world: () => import("./World"),
  country: () => import("./Country"),
  restaurant: () => import("./Restaurant"),
  "check-in": () => import("./CheckIn"),
  visit: () => import("./VisitPage"),
  backfill: () => import("./Backfill"),
  settings: () => import("./Settings"),
};

const lazyScreens = new Map<LazyRoute, Screen>();

function screenFor(name: RouteName): Screen {
  if (name === "passport") return Passport;
  if (name === "not-found") return NotFound;
  let screen = lazyScreens.get(name);
  if (!screen) {
    screen = lazy(loaders[name]);
    lazyScreens.set(name, screen);
  }
  return screen;
}

/** The screen for a route. Its component comes from a module-level cache, so every render gets the same one. */
export function renderScreen({ name, params }: Route): ReactElement {
  return createElement(screenFor(name), { params });
}
