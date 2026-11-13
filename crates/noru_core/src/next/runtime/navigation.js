// noru: browser version of `next/navigation`.
import * as React from "react";
import {
  getSnapshot,
  LocationContext,
  navigate,
  refresh,
  ParamsContext,
  SegmentsContext,
  redirectError,
  notFoundError,
  isNavigationError,
} from "noru-next/router";

function scrollOption(options) {
  return !options || options.scroll !== false;
}

const router = {
  push: function (href, options) {
    navigate(href, { scroll: scrollOption(options) });
  },
  replace: function (href, options) {
    navigate(href, { replace: true, scroll: scrollOption(options) });
  },
  back: function () {
    history.back();
  },
  forward: function () {
    history.forward();
  },
  refresh: function () {
    refresh();
  },
  prefetch: function () {},
};

export function useRouter() {
  return router;
}

function useLocation() {
  return React.useContext(LocationContext) || getSnapshot();
}

export function usePathname() {
  return useLocation().pathname;
}

export class ReadonlyURLSearchParams extends URLSearchParams {}

export function useSearchParams() {
  const search = useLocation().search;
  return React.useMemo(
    function () {
      return new ReadonlyURLSearchParams(search);
    },
    [search],
  );
}

export function useParams() {
  return React.useContext(ParamsContext);
}

export function useSelectedLayoutSegments() {
  return React.useContext(SegmentsContext);
}

export function useSelectedLayoutSegment() {
  const segments = React.useContext(SegmentsContext);
  return segments.length ? segments[0] : null;
}

export const RedirectType = { push: "push", replace: "replace" };

export function redirect(url, type) {
  throw redirectError(url, type !== "push");
}

export function permanentRedirect(url, type) {
  throw redirectError(url, type !== "push");
}

export function notFound() {
  throw notFoundError();
}

export function forbidden() {
  throw notFoundError();
}

export function unauthorized() {
  throw notFoundError();
}

export function unstable_rethrow(error) {
  if (isNavigationError(error)) throw error;
}

export function useServerInsertedHTML() {}
