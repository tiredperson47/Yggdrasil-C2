# =========================
# Build stage
# =========================
FROM golang:1.24-alpine AS builder

# Install required build tools
RUN apk add --no-cache \
    ca-certificates \
    git

WORKDIR /app

# Hosted files directory
RUN mkdir -p /app/hosted_files

# Copy go mod files first for caching
COPY go.mod go.sum ./
RUN go mod download

# Copy the rest of the source
COPY . .

# Build static binary
RUN CGO_ENABLED=0 GOOS=linux go build -o yggdrasil_core

# =========================
# Runtime stage
# =========================
FROM alpine:3.20

# Install CA certs and docker CLI for DooD
RUN apk add --no-cache ca-certificates docker-cli

WORKDIR /app

# Copy binary
COPY --from=builder /app/yggdrasil_core .

# Environment safety
ENV GIN_MODE=release

# Expose Gin port
EXPOSE 8000

CMD ["./yggdrasil_core"]
