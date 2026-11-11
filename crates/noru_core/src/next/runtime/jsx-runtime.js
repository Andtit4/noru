// noru: JSX runtime for Next.js projects.
//
// The root layout of a Next.js app renders <html>, <head> and <body>. In the browser the
// document already exists, so these elements are replaced by components that apply their
// attributes (lang, className from next/font...) to the real elements and render their children.
// Async (server) components are wrapped so that they can be rendered in the browser.
import * as React from "react";
import { jsx as reactJsx, jsxs as reactJsxs, Fragment } from "react/jsx-runtime";
import { createPortal } from "react-dom";
import { asyncSafe } from "noru-next/router";

const useIsomorphicLayoutEffect = React.useLayoutEffect;

function attrsKey(attrs) {
  const parts = [];
  Object.keys(attrs).forEach(function (key) {
    const value = attrs[key];
    if (key === "children" || typeof value === "function") return;
    parts.push(key + "=" + (value && typeof value === "object" ? JSON.stringify(value) : String(value)));
  });
  return parts.join("|");
}

function useApplyAttributes(element, attrs) {
  const key = attrsKey(attrs);
  useIsomorphicLayoutEffect(
    function () {
      const undo = [];
      Object.keys(attrs).forEach(function (name) {
        const value = attrs[name];
        if (name === "children" || name === "suppressHydrationWarning" || value == null || value === false) return;
        if (typeof value === "function") return;
        if (name === "className") {
          const classes = String(value).split(/\s+/).filter(Boolean);
          const added = classes.filter(function (c) {
            return !element.classList.contains(c);
          });
          element.classList.add.apply(element.classList, added);
          undo.push(function () {
            element.classList.remove.apply(element.classList, added);
          });
        } else if (name === "style" && typeof value === "object") {
          Object.keys(value).forEach(function (prop) {
            element.style[prop] = value[prop];
          });
          undo.push(function () {
            Object.keys(value).forEach(function (prop) {
              element.style[prop] = "";
            });
          });
        } else {
          const attr = name === "htmlFor" ? "for" : name;
          const previous = element.getAttribute(attr);
          element.setAttribute(attr, value === true ? "" : String(value));
          undo.push(function () {
            if (previous === null) element.removeAttribute(attr);
            else element.setAttribute(attr, previous);
          });
        }
      });
      return function () {
        undo.forEach(function (fn) {
          fn();
        });
      };
    },
    [element, key],
  );
}

function Html(props) {
  useApplyAttributes(document.documentElement, props);
  return props.children === undefined ? null : props.children;
}

function Body(props) {
  useApplyAttributes(document.body, props);
  return props.children === undefined ? null : props.children;
}

function Head(props) {
  return props.children == null ? null : createPortal(props.children, document.head);
}

function mapType(type) {
  if (typeof type === "string") {
    if (type === "html") return Html;
    if (type === "body") return Body;
    if (type === "head") return Head;
    return type;
  }
  return asyncSafe(type);
}

export function jsx(type, props, key) {
  return reactJsx(mapType(type), props, key);
}

export function jsxs(type, props, key) {
  return reactJsxs(mapType(type), props, key);
}

export const jsxDEV = jsx;
export { Fragment };

// Used by the JSX compiler for `<div {...props} key="k" />` (key after a spread).
export function createElement(type) {
  const args = Array.prototype.slice.call(arguments);
  args[0] = mapType(type);
  return React.createElement.apply(null, args);
}
