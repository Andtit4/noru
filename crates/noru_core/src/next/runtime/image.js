// noru: browser version of `next/image`. Imported images (`import photo from "./photo.jpg"`) know
// their size, and in production builds (with sharp installed) come with a blurred preview and AVIF /
// WebP versions in several widths: the browser picks the smallest file that fits the screen.
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
  const blur = placeholder === "blur" ? blurDataURL || (imported && imported.blurDataURL) : typeof placeholder === "string" && placeholder.indexOf("data:image/") === 0 ? placeholder : null;
  const imgStyle = Object.assign(
    fill
      ? { position: "absolute", height: "100%", width: "100%", left: 0, top: 0, right: 0, bottom: 0, color: "transparent" }
      : { color: "transparent" },
    objectFit ? { objectFit: objectFit } : null,
    objectPosition ? { objectPosition: objectPosition } : null,
    blur
      ? {
          backgroundImage: 'url("' + blur + '")',
          backgroundSize: objectFit || "cover",
          backgroundPosition: objectPosition || "50% 50%",
          backgroundRepeat: "no-repeat",
        }
      : null,
    style,
  );
  // Responsive AVIF / WebP versions (production builds).
  const sources = imported && imported.sources && !unoptimized && !loader && !overrideSrc ? imported.sources : null;
  const sizesAttr = sizes || (fill ? "100vw" : Number(w) ? "(max-width: " + Number(w) + "px) 100vw, " + Number(w) + "px" : undefined);
  return {
    props: Object.assign({}, rest, {
      src: url,
      alt: alt,
      width: fill ? undefined : w,
      height: fill ? undefined : hgt,
      sizes: sizes,
      loading: priority || preload ? "eager" : loading || "lazy",
      fetchPriority: priority ? "high" : rest.fetchPriority,
      decoding: "async",
      style: imgStyle,
    }),
    sources: sources ? { avif: sources.avif, webp: sources.webp, sizes: sizesAttr } : null,
    blur: !!blur,
  };
}

const Image = React.forwardRef(function Image(props, ref) {
  const image = getImageProps(props);
  const result = image.props;
  const onLoad = props.onLoad;
  const onLoadingComplete = props.onLoadingComplete;
  const img = React.createElement(
    "img",
    Object.assign(result, {
      ref: ref,
      onLoad:
        onLoad || onLoadingComplete || image.blur
          ? function (event) {
              // The blurred preview is only shown until the image is there.
              if (image.blur) event.currentTarget.style.backgroundImage = "none";
              if (onLoad) onLoad(event);
              if (onLoadingComplete) onLoadingComplete(event.currentTarget);
            }
          : undefined,
    }),
  );
  if (!image.sources) return img;
  // <picture> with display: contents does not change the layout (the <img> stays the box).
  return React.createElement(
    "picture",
    { style: { display: "contents" } },
    React.createElement("source", { type: "image/avif", srcSet: image.sources.avif, sizes: image.sources.sizes }),
    React.createElement("source", { type: "image/webp", srcSet: image.sources.webp, sizes: image.sources.sizes }),
    img,
  );
});

export default Image;
