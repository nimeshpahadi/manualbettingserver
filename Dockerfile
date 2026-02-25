FROM rustlang/rust:nightly AS builder
ENV CARGO_BUILD_JOBS=1
ENV CARGO_INCREMENTAL=0
ENV RUSTFLAGS="-C debuginfo=0 -C target-feature=+crt-static"
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    build-essential \
    tzdata \
    curl \
    musl-tools \
    && rm -rf /var/lib/apt/lists/*
RUN rustup target add x86_64-unknown-linux-musl
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
RUN mkdir -p src && echo "fn main() {}" > src/main.rs
RUN cargo fetch
COPY src ./src
COPY migrations ./migrations
RUN cargo build --release --locked --target x86_64-unknown-linux-musl

FROM alpine:3.19
RUN apk add --no-cache bash curl tzdata
WORKDIR /usr/local/bin
COPY --from=builder /app/target/x86_64-unknown-linux-musl/release/betstream ./betstream
EXPOSE 3001
CMD ["./betstream"]
