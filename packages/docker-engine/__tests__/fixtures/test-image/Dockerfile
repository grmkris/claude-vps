FROM alpine:3.19

# Install minimal test utilities
RUN apk add --no-cache \
    bash \
    curl

# Create coder user (matches production box-base)
RUN addgroup -g 1000 coder && \
    adduser -D -u 1000 -G coder coder

# Create expected directories
RUN mkdir -p /home/coder/workspace /home/coder/.config /home/coder/.cache /home/coder/.inbox

# Simple healthcheck
HEALTHCHECK --interval=5s --timeout=3s --retries=3 \
  CMD echo "healthy"

# Keep container running
CMD ["tail", "-f", "/dev/null"]
