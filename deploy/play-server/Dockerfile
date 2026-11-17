# noru play rooms server (`noru play-server`): the multiplayer rooms of noru play games.
#
#   docker build -t noru-play-server deploy/play-server
#   docker run -d -p 4040:4040 noru-play-server --allow-origin https://my-site.netlify.app
#
# The image builds noru from GitHub (REPO / REF), so it needs no source code next to it.

FROM rust:1-slim-bookworm AS build
ARG REPO=https://github.com/Andtit4/noru
ARG REF=main
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch "$REF" "$REPO" /src
WORKDIR /src
RUN cargo build --release -p noru_cli && strip target/release/noru

FROM debian:bookworm-slim
COPY --from=build /src/target/release/noru /usr/local/bin/noru
USER nobody
EXPOSE 4040
# A plain GET on the port answers {"server":"noru play rooms",...}.
HEALTHCHECK --interval=30s --timeout=3s CMD ["bash", "-c", "exec 3<>/dev/tcp/127.0.0.1/4040 && printf 'GET / HTTP/1.0\\r\\n\\r\\n' >&3 && grep -q 'noru play rooms' <&3"]
ENTRYPOINT ["noru", "play-server", "--host", "0.0.0.0", "--port", "4040"]
CMD []
