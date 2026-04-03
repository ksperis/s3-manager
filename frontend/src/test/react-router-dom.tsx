import { createElement } from "react";
import type { MemoryRouterProps, RouteObject, RouterProviderProps } from "react-router-dom-real";
import {
  MemoryRouter as BaseMemoryRouter,
  RouterProvider as BaseRouterProvider,
  createBrowserRouter as baseCreateBrowserRouter,
  createMemoryRouter as baseCreateMemoryRouter,
} from "react-router-dom-real";

export * from "react-router-dom-real";

const routerFuture = {
  v7_relativeSplatPath: true,
  v7_startTransition: true,
} as const;

export function MemoryRouter(props: MemoryRouterProps) {
  return createElement(BaseMemoryRouter, {
    ...props,
    future: { ...routerFuture, ...props.future },
  });
}

export function RouterProvider(props: RouterProviderProps) {
  return createElement(BaseRouterProvider, {
    ...props,
    future: { v7_startTransition: true, ...props.future },
  });
}

export function createMemoryRouter(routes: RouteObject[], opts?: Parameters<typeof baseCreateMemoryRouter>[1]) {
  return baseCreateMemoryRouter(routes, {
    ...opts,
    future: { ...routerFuture, ...opts?.future },
  });
}

export function createBrowserRouter(routes: RouteObject[], opts?: Parameters<typeof baseCreateBrowserRouter>[1]) {
  return baseCreateBrowserRouter(routes, {
    ...opts,
    future: { ...routerFuture, ...opts?.future },
  });
}
