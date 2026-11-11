// noru: browser version of `next/image` (a plain <img>, no image optimization server).
import * as React from "react";

function staticSrc(src) {
  if (src && typeof src === "object") return src.default && src.default.src ? src.default : src;
  return null;
}

export function getImageProps(props) {
  const {
    src,
    alt,
    width,
    height,
    fill,
    sizes,
    quality,
    priority,
    preload,
    loading,
    placeholder,
    blurDataURL,
    unoptimized,
    loader,
    style,
    overrideSrc,
    onLoadingComplete,
    layout,
    objectFit,
    objectPosition,
    lazyBoundary,
    lazyRoot,
    ...rest
  } = props;
  const imported = staticSrc(src);
  let url = imported ? imported.src : src;
  const w = width != null ? width : imported ? imported.width : undefined;
  const hgt = height != null ? height : imported ? imported.height : undefined;
  if (loader && !unoptimized && url) url = loader({ src: url, width: Number(w) || 0, quality: quality || 75 });
  if (overrideSrc) url = overrideSrc;
  const imgStyle = Object.assign(
    fill
      ? { position: "absolute", height: "100%", width: "100%", left: 0, top: 0, right: 0, bottom: 0, color: "transparent" }
      : { color: "transparent" },
    objectFit ? { objectFit: objectFit } : null,
    objectPosition ? { objectPosition: objectPosition } : null,
    style,
  );
  return {
    props: Object.assign({}, rest, {
      src: url,
      alt: alt,
      width: fill ? undefined : w,
      height: fill ? undefined : hgt,
      sizes: sizes,
      loading: priority || preload ? "eager" : loading || "lazy",
      decoding: "async",
      style: imgStyle,
    }),
  };
}

const Image = React.forwardRef(function Image(props, ref) {
  const result = getImageProps(props).props;
  const onLoad = props.onLoad;
  const onLoadingComplete = props.onLoadingComplete;
  return React.createElement(
    "img",
    Object.assign(result, {
      ref: ref,
      onLoad:
        onLoad || onLoadingComplete
          ? function (event) {
              if (onLoad) onLoad(event);
              if (onLoadingComplete) onLoadingComplete(event.currentTarget);
            }
          : undefined,
    }),
  );
});

export default Image;
