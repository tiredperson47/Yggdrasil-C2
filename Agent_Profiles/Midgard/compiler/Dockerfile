FROM debian:latest

ARG PROFILE=Midgard

ENV DEBIAN_FRONTEND=noninteractive
ENV PROFILE=${PROFILE}

RUN dpkg --add-architecture arm64 \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    binutils-aarch64-linux-gnu \
    binutils-x86-64-linux-gnu \
    build-essential \
    ca-certificates \
    gcc-aarch64-linux-gnu \
    gcc-x86-64-linux-gnu \
    libmbedtls-dev \
    libmbedtls-dev:arm64 \
    liburing-dev \
    liburing-dev:arm64 \
    make \
    pkg-config \
    xxd \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app/${PROFILE}

COPY . .

RUN chmod +x ./compiler/build

ENTRYPOINT ["./compiler/build"]
