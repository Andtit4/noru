// noru: browser version of `next/link`.
import * as React from "react";
import { navigate, prefetchLevel, prefetchRoute } from "noru-next/router";

// Pages are downloaded before the click, as much as the connection allows: links on screen on a
// good connection, the hovered / touched link on 3G, nothing with the data saver or on 2G.
const prefetched = new Set();
function prefetch(url) {
  if (!url || prefetched.has(url) || prefetchLevel() === "none") return;
  prefetched.add(url);
  prefetchRoute(url);
}

let observer = null;
const observed = new WeakMap();
function observe(element, url) {
  if (typeof IntersectionObserver !== "function") return function () {};
  if (!observer) {
    observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        const target = observed.get(entry.target);
        observer.unobserve(entry.target);
        if (target && prefetchLevel() === "visible") {
          const idle = window.requestIdleCallback || function (fn) { return setTimeout(fn, 1); };
          idle(function () {
            prefetch(target);
          });
        }
      });
    }, { rootMargin: "200px" });
  }
  observed.set(element, url);
  observer.observe(element);
  return function () {
    observer.unobserve(element);
    observed.delete(element);
  };
}

function useAutoPrefetch(url, enabled, forwardedRef) {
  const element = React.useRef(null);
  React.useEffect(function () {
    if (!enabled || !element.current) return undefined;
    return observe(element.current, url);
  }, [url, enabled]);
  return React.useCallback(function (node) {
    element.current = node;
    if (typeof forwardedRef === "function") forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  }, [forwardedRef]);
}

function intentHandler(url, original) {
  return function (event) {
    if (original) original(event);
    prefetch(url);
  };
}

export function formatUrl(href) {
  if (typeof href === "string") return href;
  if (!href || typeof href !== "object") return "";
  let search = href.search || "";
  if (!search && href.query) {
    const params = new URLSearchParams();
    Object.keys(href.query).forEach(function (key) {
      const value = href.query[key];
      if (Array.isArray(value)) {
        value.forEach(function (v) {
          params.append(key, String(v));
        });
      } else if (value != null) {
        params.append(key, String(value));
      }
    });
    const query = params.toString();
    search = query ? "?" + query : "";
  }
  const hash = href.hash ? (String(href.hash).charAt(0) === "#" ? href.hash : "#" + href.hash) : "";
  return (href.pathname || "") + search + hash;
}

function isModifiedEvent(event) {
  const target = event.currentTarget.getAttribute("target");
  return (
    (target && target !== "_self") ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    event.button !== 0 ||
    event.currentTarget.hasAttribute("download")
  );
}

function clickHandler(url, replace, scroll, onClick) {
  return function (event) {
    if (onClick) onClick(event);
    if (event.defaultPrevented || isModifiedEvent(event)) return;
    const target = new URL(url, location.href);
    if (target.origin !== location.origin) return;
    // Same page, only the hash changes: let the browser scroll.
    if (target.hash && target.pathname === location.pathname && target.search === location.search) return;
    event.preventDefault();
    navigate(target.href, { replace: !!replace, scroll: scroll !== false });
  };
}

const Link = React.forwardRef(function Link(props, ref) {
  const {
    href,
    as,
    replace,
    scroll,
    shallow,
    passHref,
    prefetch,
    locale,
    legacyBehavior,
    onClick,
    children,
    ...rest
  } = props;
  const url = formatUrl(as != null ? as : href);
  const internal = url.charAt(0) === "/" && url.charAt(1) !== "/";
  const setRef = useAutoPrefetch(url, internal && prefetch !== false, ref);
  if (legacyBehavior) {
    const child = React.Children.only(children);
    return React.cloneElement(child, {
      href: url,
      ref: setRef,
      onClick: clickHandler(url, replace, scroll, child.props.onClick),
      onMouseEnter: internal ? intentHandler(url, child.props.onMouseEnter) : child.props.onMouseEnter,
      onTouchStart: internal ? intentHandler(url, child.props.onTouchStart) : child.props.onTouchStart,
    });
  }
  return React.createElement(
    "a",
    Object.assign({}, rest, {
      ref: setRef,
      href: url,
      onClick: clickHandler(url, replace, scroll, onClick),
      onMouseEnter: internal ? intentHandler(url, rest.onMouseEnter) : rest.onMouseEnter,
      onTouchStart: internal ? intentHandler(url, rest.onTouchStart) : rest.onTouchStart,
      onFocus: internal ? intentHandler(url, rest.onFocus) : rest.onFocus,
    }),
    children,
  );
});

export function useLinkStatus() {
  return { pending: false };
}

export default Link;
