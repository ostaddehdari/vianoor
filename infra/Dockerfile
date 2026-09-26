FROM node:24.19.0-bookworm-slim AS native-image
# Build for baseline x86 CPUs as the VPS does not expose SSE4.2 or Wasm SIMD.
RUN apt-get update && apt-get install -y --no-install-recommends build-essential python3 meson ninja-build pkg-config curl ca-certificates xz-utils libglib2.0-dev libexpat1-dev libjpeg62-turbo-dev libpng-dev libwebp-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /native
RUN apt-get update && apt-get install -y --no-install-recommends libexif-dev && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://github.com/libvips/libvips/releases/download/v8.18.7/vips-8.18.7.tar.xz -o vips.tar.xz && echo '5baaead3b0bb20ffdb9e9ff09aa9fda08620923df77b63b436654cb5e0b3bf94  vips.tar.xz' | sha256sum -c - && tar -xf vips.tar.xz && meson setup vips-build vips-8.18.7 --prefix=/usr/local --libdir=lib --buildtype=release -Dauto_features=disabled -Dcpp_std=c++17 -Djpeg=enabled -Dpng=enabled -Dwebp=enabled -Dexif=enabled && meson compile -C vips-build -j 2 && meson install -C vips-build
ENV PKG_CONFIG_PATH=/usr/local/lib/pkgconfig LD_LIBRARY_PATH=/usr/local/lib
RUN npm install --no-audit --no-fund sharp@0.35.4 node-addon-api@8.9.2 node-gyp@12.4.0 && npm explore sharp -- npm run build

FROM node:24.19.0-bookworm-slim AS build
WORKDIR /app
RUN npm install -g npm@11.9.0
COPY . .
RUN npm ci --no-audit --no-fund && npm run build:packages && npm run build:services
FROM node:24.19.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 LD_LIBRARY_PATH=/usr/local/lib
RUN apt-get update && apt-get install -y --no-install-recommends libglib2.0-0 libexpat1 libjpeg62-turbo libpng16-16 libwebp7 libwebpmux3 libwebpdemux2 libexif12 && rm -rf /var/lib/apt/lists/*
COPY --from=native-image /usr/local/lib /usr/local/lib
COPY --from=build --chown=node:node /app /app
COPY --from=native-image --chown=node:node /native/node_modules/sharp/src/build/Release /app/node_modules/sharp/src/build/Release
RUN node scripts/users/check-image-runtime.mjs
RUN mkdir -p /var/lib/vianoor/avatars && chown node:node /var/lib/vianoor/avatars
USER node
CMD ["node", "services/api-gateway/dist/main.js"]
