# =========================
# ---------- BUILD STAGE ----------
# =========================
FROM rustlang/rust:nightly AS builder

# ---- Rust build optimizations for low RAM ----
ENV CARGO_BUILD_JOBS=1
ENV CARGO_INCREMENTAL=0
ENV RUSTFLAGS="-C debuginfo=0"

# ---- System deps ----
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    build-essential \
    tzdata \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ---- Copy manifests only (dependency caching) ----
COPY Cargo.toml Cargo.lock ./

# Dummy source to allow cargo fetch
RUN mkdir -p src && echo "fn main() {}" > src/main.rs

# Fetch dependencies (cached unless Cargo.toml changes)
RUN cargo fetch

# ---- Copy real source ----
COPY src ./src
COPY migrations ./migrations

# ---- Build release binary ----
RUN cargo build --release --locked


# =========================
# ---------- RUNTIME STAGE ----------
# =========================
FROM alpine:3.19

# Runtime deps only
RUN apk add --no-cache bash curl tzdata

WORKDIR /usr/local/bin

# Copy compiled binary
COPY --from=builder /app/target/release/betstream ./betstream

# Copy seed script
COPY ./data/seed.sh /data/seed.sh
RUN chmod +x /data/seed.sh

EXPOSE 3001

# ---- Startup logic ----
CMD bash -c '\
    ./betstream & \
    BACKEND_PID=$!; \
    echo "⏳ Waiting for backend to start..."; \
    until curl -s http://localhost:3001/api/v1/accounts >/dev/null 2>&1; do sleep 1; done; \
    echo "✅ Backend ready. Running seeder..."; \
    /data/seed.sh; \
    wait $BACKEND_PID \
'
