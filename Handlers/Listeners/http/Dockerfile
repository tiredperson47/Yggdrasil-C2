# =========================
# Build stage
# =========================
FROM golang:1.24-alpine AS builder

# Install required build tools
RUN apk add --no-cache \
    git

WORKDIR /app

# Copy go mod files first for caching
COPY go.mod go.sum ./
RUN go mod download

# Copy the rest of the source
COPY . .

# Build static binary
RUN CGO_ENABLED=0 GOOS=linux go build -o http

# =========================
# Runtime stage
# =========================
FROM alpine:3.20

WORKDIR /app

# Copy binary
COPY --from=builder /app/http .


# Environment safety
ENV GIN_MODE=release

# Expose Gin port
EXPOSE 80

CMD ["./http"]
