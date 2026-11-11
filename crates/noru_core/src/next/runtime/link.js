// noru: browser version of `next/link`.
import * as React from "react";
import { navigate } from "noru-next/router";

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
  if (legacyBehavior) {
    const child = React.Children.only(children);
    return React.cloneElement(child, {
      href: url,
      ref: ref,
      onClick: clickHandler(url, replace, scroll, child.props.onClick),
    });
  }
  return React.createElement(
    "a",
    Object.assign({}, rest, { ref: ref, href: url, onClick: clickHandler(url, replace, scroll, onClick) }),
    children,
  );
});

export function useLinkStatus() {
  return { pending: false };
}

export default Link;
